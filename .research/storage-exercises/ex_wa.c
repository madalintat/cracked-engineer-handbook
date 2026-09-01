/* Write amplification of an FTL under random writes: greedy GC, page-mapped. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define PAGES_PER_BLOCK 256
typedef struct { int *lpn; int valid; int erases; } Block;
typedef struct {
    int nblocks, npages_phys, nlpn;
    Block *b; int *l2p;              /* logical page -> physical page, -1 = unmapped */
    int cur_block, cur_page;
    long host_writes, flash_writes, erases;
} Ftl;
static Ftl *ftl_new(int user_pages,double op){
    Ftl*f=calloc(1,sizeof*f);
    f->nlpn=user_pages;
    int phys=(int)(user_pages*(1.0+op));
    f->nblocks=(phys+PAGES_PER_BLOCK-1)/PAGES_PER_BLOCK;
    f->npages_phys=f->nblocks*PAGES_PER_BLOCK;
    f->b=calloc(f->nblocks,sizeof(Block));
    for(int i=0;i<f->nblocks;i++){ f->b[i].lpn=malloc(PAGES_PER_BLOCK*sizeof(int));
        for(int j=0;j<PAGES_PER_BLOCK;j++) f->b[i].lpn[j]=-1; f->b[i].valid=0; }
    f->l2p=malloc(user_pages*sizeof(int));
    for(int i=0;i<user_pages;i++) f->l2p[i]=-1;
    f->cur_block=0; f->cur_page=0;
    return f;
}
static void invalidate(Ftl*f,int ppn){ if(ppn<0)return; int bi=ppn/PAGES_PER_BLOCK,pi=ppn%PAGES_PER_BLOCK;
    if(f->b[bi].lpn[pi]>=0){ f->b[bi].lpn[pi]=-1; f->b[bi].valid--; } }
static int free_blocks(Ftl*f){ int n=0; for(int i=0;i<f->nblocks;i++) if(f->b[i].valid==0 && i!=f->cur_block) n++; return n; }
static void gc(Ftl*f);
/* place one physical page holding lpn */
static int emit(Ftl*f,int lpn){
    if(f->cur_page==PAGES_PER_BLOCK){          /* current block full: find a fresh one */
        int nb=-1;
        for(int i=0;i<f->nblocks;i++) if(f->b[i].valid==0 && i!=f->cur_block){nb=i;break;}
        if(nb<0){ gc(f);
            for(int i=0;i<f->nblocks;i++) if(f->b[i].valid==0 && i!=f->cur_block){nb=i;break;}
            if(nb<0){ fprintf(stderr,"FTL wedged\n"); exit(1);} }
        f->cur_block=nb; f->cur_page=0;
    }
    int ppn=f->cur_block*PAGES_PER_BLOCK+f->cur_page++;
    f->b[f->cur_block].lpn[ppn%PAGES_PER_BLOCK]=lpn;
    f->b[f->cur_block].valid++;
    f->flash_writes++;
    return ppn;
}
/* greedy GC: erase the block with fewest valid pages, relocating survivors */
static void gc(Ftl*f){
    int victim=-1,best=PAGES_PER_BLOCK+1;
    for(int i=0;i<f->nblocks;i++){ if(i==f->cur_block) continue;
        if(f->b[i].valid<best){best=f->b[i].valid;victim=i;} }
    if(victim<0) return;
    for(int j=0;j<PAGES_PER_BLOCK;j++){ int lpn=f->b[victim].lpn[j];
        if(lpn>=0){ f->b[victim].lpn[j]=-1; f->b[victim].valid--; f->l2p[lpn]=emit(f,lpn); } }
    f->b[victim].valid=0; f->b[victim].erases++; f->erases++;
    for(int j=0;j<PAGES_PER_BLOCK;j++) f->b[victim].lpn[j]=-1;
}
static void host_write(Ftl*f,int lpn){
    f->host_writes++;
    if(free_blocks(f)<2) gc(f);
    invalidate(f,f->l2p[lpn]);
    f->l2p[lpn]=emit(f,lpn);
}
int main(void){
    printf("%-6s %-12s %10s %10s %8s\n","OP%","pattern","host wr","flash wr","WA");
    double ops[]={0.02,0.07,0.14,0.28,0.50};
    for(int seq=0;seq<2;seq++)
    for(unsigned k=0;k<sizeof ops/sizeof*ops;k++){
        int user=200*PAGES_PER_BLOCK;                 /* 200 blocks of user data */
        Ftl*f=ftl_new(user,ops[k]);
        for(int i=0;i<user;i++) host_write(f,i);      /* fill the drive once */
        long base_h=f->host_writes, base_f=f->flash_writes;
        srand(12345);
        for(int i=0;i<4*user;i++) host_write(f, seq ? (i%user) : (rand()%user));
        double wa=(double)(f->flash_writes-base_f)/(double)(f->host_writes-base_h);
        printf("%-6.0f %-12s %10ld %10ld %8.2f\n", ops[k]*100, seq?"sequential":"random",
               f->host_writes-base_h, f->flash_writes-base_f, wa);
        free(f);
    }
    return 0;
}
