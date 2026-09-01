/* B+tree node split with invariant checks, plus the write-amplification
   comparison against an LSM under the same key sequence.                */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define ORDER 8                     /* max children; max keys = ORDER-1 */
#define MAXK (ORDER-1)
#define MINK ((ORDER+1)/2 - 1)      /* min keys in a non-root node */
typedef struct Node {
    int leaf, n; int key[MAXK+1];
    struct Node *kid[ORDER+1]; struct Node *next;
} Node;
static long pages_written;          /* every node touched-and-dirtied = one page write */
static void dirty(Node*x){ (void)x; pages_written++; }
static Node* nnew(int leaf){ Node*x=calloc(1,sizeof*x); x->leaf=leaf; return x; }

/* split child i of x (x not full) */
static void split_child(Node*x,int i){
    Node*y=x->kid[i]; Node*z=nnew(y->leaf);
    int mid=y->n/2; int up;
    if(y->leaf){
        z->n=y->n-mid; memcpy(z->key,y->key+mid,z->n*sizeof(int));
        y->n=mid; up=z->key[0];              /* leaf: separator is COPIED up */
        z->next=y->next; y->next=z;
    } else {
        up=y->key[mid];                      /* internal: separator MOVES up */
        z->n=y->n-mid-1; memcpy(z->key,y->key+mid+1,z->n*sizeof(int));
        memcpy(z->kid,y->kid+mid+1,(z->n+1)*sizeof(Node*));
        y->n=mid;
    }
    for(int j=x->n;j>i;j--){ x->key[j]=x->key[j-1]; x->kid[j+1]=x->kid[j]; }
    x->key[i]=up; x->kid[i+1]=z; x->n++;
    dirty(y); dirty(z); dirty(x);
}
static void insert_nonfull(Node*x,int k){
    int i=x->n-1;
    if(x->leaf){
        while(i>=0 && k<x->key[i]){ x->key[i+1]=x->key[i]; i--; }
        x->key[i+1]=k; x->n++; dirty(x);
    } else {
        while(i>=0 && k<x->key[i]) i--;
        i++;
        if(x->kid[i]->n==MAXK){ split_child(x,i); if(k>=x->key[i]) i++; }
        insert_nonfull(x->kid[i],k);
    }
}
static Node* insert(Node*root,int k){
    if(root->n==MAXK){ Node*s=nnew(0); s->kid[0]=root; split_child(s,0); insert_nonfull(s,k); return s; }
    insert_nonfull(root,k); return root;
}
/* ---- invariant checker ---- */
static int fail;
static void chk(int c,const char*m){ if(!c){ printf("  INVARIANT VIOLATED: %s\n",m); fail++; } }
static int verify(Node*x,int isroot,int depth,int*leafdepth){
    for(int i=1;i<x->n;i++) chk(x->key[i-1]<=x->key[i],"keys not sorted in node");
    chk(x->n<=MAXK,"node over-full");
    if(!isroot) chk(x->n>=MINK,"node under-full");
    if(x->leaf){ if(*leafdepth<0)*leafdepth=depth; chk(depth==*leafdepth,"leaves at differing depths"); return x->n; }
    int tot=0;
    for(int i=0;i<=x->n;i++){ chk(x->kid[i]!=NULL,"missing child"); tot+=verify(x->kid[i],0,depth+1,leafdepth); }
    for(int i=0;i<x->n;i++){                          /* separator ordering */
        int mx=-1<<30; Node*c=x->kid[i]; while(!c->leaf) c=c->kid[c->n]; if(c->n) mx=c->key[c->n-1];
        int mn= 1<<30; Node*d=x->kid[i+1]; while(!d->leaf) d=d->kid[0]; if(d->n) mn=d->key[0];
        chk(mx<=x->key[i],"left subtree key > separator");
        chk(mn>=x->key[i],"right subtree key < separator");
    }
    return tot;
}
static int height(Node*x){ int h=0; while(!x->leaf){ x=x->kid[0]; h++; } return h; }
static int count_leaves_scan(Node*root){ Node*c=root; while(!c->leaf) c=c->kid[0];
    int n=0; while(c){ for(int i=1;i<c->n;i++) if(c->key[i-1]>c->key[i]) { printf("  LEAF CHAIN UNSORTED\n"); fail++; } n+=c->n; c=c->next; } return n; }

int main(void){
    const int N=200000;
    for(int mode=0;mode<2;mode++){
        Node*root=nnew(1); pages_written=0; fail=0;
        int *keys=malloc(N*sizeof(int));
        for(int i=0;i<N;i++) keys[i]=i;
        if(mode==0){ srand(99); for(int i=N-1;i>0;i--){int j=rand()%(i+1);int t=keys[i];keys[i]=keys[j];keys[j]=t;} }
        for(int i=0;i<N;i++) root=insert(root,keys[i]);
        int ld=-1; int tot=verify(root,1,0,&ld);
        int chain=count_leaves_scan(root);
        printf("%-10s N=%d height=%d keys-in-leaves=%d leaf-chain=%d invariant-failures=%d\n",
            mode?"SEQUENTIAL":"RANDOM",N,height(root),tot,chain,fail);
        printf("           page writes=%ld  ->  B-tree write amplification = %.2f pages/key\n",
            pages_written,(double)pages_written/N);
        printf("           CHECK all-keys-present : %s\n", (tot==N&&chain==N)?"PASS":"FAIL");
        printf("           CHECK invariants-hold  : %s\n", fail==0?"PASS":"FAIL");
        free(keys);
    }
    /* LSM under the identical workload: writes are batched into sorted runs.  */
    { const int N=200000, MEMT=4096, FANOUT=10;
      long lsm_pages=0;
      long flushes=N/MEMT;                       /* each flush writes MEMT keys sequentially */
      lsm_pages += (long)flushes*MEMT;           /* L0 write: 1 page-equivalent per key      */
      long lvl=MEMT*FANOUT; long moved=(long)N;
      int levels=0;
      while(lvl < (long)N){ lsm_pages += moved; levels++; lvl*=FANOUT; }   /* rewrite once per level */
      printf("%-10s N=%d levels=%d  page writes=%ld -> LSM write amplification = %.2f pages/key\n",
            "LSM",N,levels+1,lsm_pages,(double)lsm_pages/N);
      printf("           (leveled compaction, memtable=%d, fanout=%d; each key is rewritten once per level it descends)\n",MEMT,FANOUT);
    }
    return 0;
}
