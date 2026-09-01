/* THE tradeoff: B-tree vs LSM write amplification, measured in BYTES ACTUALLY
   WRITTEN TO THE DEVICE, under a bounded LRU buffer pool. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define PAGE 4096
#define REC  16            /* bytes per record: 8-byte key + 8-byte value */
#define FANOUT_LEAF (PAGE/REC)          /* 256 records per leaf page */

/* ---------- bounded LRU buffer pool over abstract page ids ---------- */
typedef struct { int *pid; char *dirty; int cap, n; long writebacks; } Pool;
static Pool* pool_new(int cap){ Pool*p=calloc(1,sizeof*p); p->cap=cap;
    p->pid=malloc(cap*sizeof(int)); p->dirty=calloc(cap,1); p->n=0; return p; }
/* touch page, marking it dirty; LRU = move-to-front on a small array */
static void pool_touch(Pool*p,int pid,int dirty){
    for(int i=0;i<p->n;i++) if(p->pid[i]==pid){
        int d=p->dirty[i];
        memmove(p->pid+1,p->pid,i*sizeof(int)); memmove(p->dirty+1,p->dirty,i);
        p->pid[0]=pid; p->dirty[0]=d|dirty; return; }
    if(p->n==p->cap){                       /* evict LRU */
        if(p->dirty[p->n-1]) p->writebacks++;
        p->n--;
    }
    memmove(p->pid+1,p->pid,p->n*sizeof(int)); memmove(p->dirty+1,p->dirty,p->n);
    p->pid[0]=pid; p->dirty[0]=dirty; p->n++;
}
static void pool_flush(Pool*p){ for(int i=0;i<p->n;i++) if(p->dirty[i]) p->writebacks++; }

int main(void){
    const int N=1000000;                       /* 1M records = 16 MB of user data */
    const long user_bytes=(long)N*REC;
    int nleaf=(N+FANOUT_LEAF-1)/FANOUT_LEAF;   /* 3907 leaf pages */
    printf("workload: %d records x %d B = %.1f MB user data; %d leaf pages of %d B\n\n",
           N,REC,user_bytes/1e6,nleaf,PAGE);
    printf("%-12s %-10s %12s %14s %10s\n","index","order","page writes","bytes written","write amp");

    int pools[]={64, 512, 4096};               /* buffer pool sizes in pages: 0.25MB, 2MB, 16MB(=whole tree) */
    for(unsigned pi=0;pi<sizeof pools/sizeof*pools;pi++)
    for(int seq=0;seq<2;seq++){
        Pool*p=pool_new(pools[pi]);
        srand(4242);
        for(int i=0;i<N;i++){
            /* which leaf page does this key land in? */
            int leaf = seq ? (i/FANOUT_LEAF) : (rand()%nleaf);
            pool_touch(p,leaf,1);
        }
        pool_flush(p);
        long bytes=p->writebacks*(long)PAGE;
        char lbl[32]; snprintf(lbl,32,"B-tree/%dp",pools[pi]);
        printf("%-12s %-10s %12ld %14ld %9.1fx\n", lbl, seq?"sequential":"random",
               p->writebacks, bytes, (double)bytes/user_bytes);
        free(p);
    }
    /* ---- LSM: every write is sequential; a record is rewritten once per level ---- */
    printf("\n");
    int memt_pages=512;                                   /* 2 MB memtable */
    long memt_recs=(long)memt_pages*FANOUT_LEAF;
    int fanout=10;
    long total=0; long lvlsz=memt_recs;  int levels=0;
    total += N;                                           /* L0 flush */
    while(lvlsz < (long)N){ total += N; levels++; lvlsz*=fanout; }
    long lsm_bytes=total*REC;
    printf("%-12s %-10s %12ld %14ld %9.1fx  (%d levels, fanout %d, all writes sequential)\n",
        "LSM leveled","any",lsm_bytes/PAGE,lsm_bytes,(double)lsm_bytes/user_bytes,levels+1,fanout);
    long lsm_t_bytes=(long)(N*(1.0+levels*1.0/ (fanout/2.0)))*REC;   /* tiered: ~1 rewrite per level / (T/2) */
    printf("%-12s %-10s %12ld %14ld %9.1fx  (fewer rewrites, more runs to read)\n",
        "LSM tiered","any",lsm_t_bytes/PAGE,lsm_t_bytes,(double)lsm_t_bytes/user_bytes);

    printf("\nread cost (point lookup, cold):\n");
    printf("  B-tree      : ~%d page reads (tree height), the last one is the leaf\n", 3);
    printf("  LSM leveled : ~%d runs to check, but a Bloom filter makes all but one ~free\n", levels+1);
    return 0;
}
