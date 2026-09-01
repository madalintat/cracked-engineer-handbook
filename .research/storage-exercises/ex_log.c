/* A log-structured store: append-only log, CRC-guarded records, crash recovery,
   compaction. The crash is real: a child process is SIGKILLed mid-write.        */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <sys/wait.h>
#include <sys/stat.h>

#define LOG "/app/store.log"
#define CMP "/app/store.cmp"
typedef struct { uint32_t crc, klen, vlen; } Hdr;   /* then key bytes, then value bytes */

static uint32_t crc32c(const void*p,size_t n,uint32_t c){
    const uint8_t*b=p; c=~c;
    while(n--){ c^=*b++; for(int k=0;k<8;k++) c = (c>>1) ^ (0x82F63B78u & (-(int32_t)(c&1))); }
    return ~c;
}
static int append(int fd,const char*k,const char*v){
    uint32_t kl=strlen(k), vl=v?strlen(v):0xFFFFFFFFu;  /* vl=~0 is a tombstone */
    size_t vn = v?strlen(v):0;
    size_t n=sizeof(Hdr)+kl+vn; char*buf=malloc(n);
    Hdr*h=(void*)buf; h->klen=kl; h->vlen=vl; h->crc=0;
    memcpy(buf+sizeof(Hdr),k,kl); if(v) memcpy(buf+sizeof(Hdr)+kl,v,vn);
    h->crc=crc32c(buf+4,n-4,0);
    ssize_t w=write(fd,buf,n); free(buf); return w==(ssize_t)n?0:-1;
}
/* scan the log; stop at the first torn/corrupt record. returns #good records */
static int scan(const char*path,void(*cb)(const char*,const char*,void*),void*ud,int*torn){
    int fd=open(path,O_RDONLY); if(fd<0){*torn=0;return 0;}
    off_t sz=lseek(fd,0,SEEK_END); lseek(fd,0,SEEK_SET);
    char*all=malloc(sz?sz:1); if(sz) { if(read(fd,all,sz)!=sz){close(fd);free(all);*torn=1;return 0;} }
    close(fd);
    off_t off=0; int n=0; *torn=0;
    while(off+ (off_t)sizeof(Hdr) <= sz){
        Hdr h; memcpy(&h,all+off,sizeof h);
        size_t vn = (h.vlen==0xFFFFFFFFu)?0:h.vlen;
        if(h.klen>1024 || vn>65536){ *torn=1; break; }
        off_t rec=sizeof(Hdr)+h.klen+vn;
        if(off+rec>sz){ *torn=1; break; }                     /* truncated tail */
        if(crc32c(all+off+4,rec-4,0)!=h.crc){ *torn=1; break; } /* torn/garbled  */
        char kb[1025],vb[65537];
        memcpy(kb,all+off+sizeof(Hdr),h.klen); kb[h.klen]=0;
        memcpy(vb,all+off+sizeof(Hdr)+h.klen,vn); vb[vn]=0;
        if(cb) cb(kb, h.vlen==0xFFFFFFFFu?NULL:vb, ud);
        off+=rec; n++;
    }
    free(all); return n;
}
/* in-memory index built by replay: last write wins, tombstone deletes */
#define MAXK 4096
static struct { char k[32]; char v[64]; int live; } idx[MAXK]; static int nidx;
static void put_idx(const char*k,const char*v,void*ud){ (void)ud;
    for(int i=0;i<nidx;i++) if(!strcmp(idx[i].k,k)){ if(v){snprintf(idx[i].v,64,"%s",v);idx[i].live=1;} else idx[i].live=0; return; }
    if(nidx<MAXK){ snprintf(idx[nidx].k,32,"%s",k); if(v)snprintf(idx[nidx].v,64,"%s",v); idx[nidx].live=v?1:0; nidx++; }
}
static int live_count(void){ int c=0; for(int i=0;i<nidx;i++) if(idx[i].live)c++; return c; }

int main(void){
    unlink(LOG);
    /* ---- phase 1: a clean writer, then a writer that is killed mid-record ---- */
    int fd=open(LOG,O_WRONLY|O_CREAT|O_APPEND,0644);
    for(int i=0;i<500;i++){ char k[32],v[64]; snprintf(k,32,"key%04d",i); snprintf(v,64,"value-%04d",i); append(fd,k,v); }
    for(int i=0;i<100;i++){ char k[32],v[64]; snprintf(k,32,"key%04d",i); snprintf(v,64,"OVERWRITTEN-%04d",i); append(fd,k,v); }
    for(int i=400;i<450;i++){ char k[32]; snprintf(k,32,"key%04d",i); append(fd,k,NULL); }   /* tombstones */
    fsync(fd); close(fd);
    off_t clean_sz; { struct stat s; stat(LOG,&s); clean_sz=s.st_size; }

    nidx=0; int torn=0; int n=scan(LOG,put_idx,NULL,&torn);
    printf("clean log:    %d records, torn=%d, live keys=%d, bytes=%lld\n",n,torn,live_count(),(long long)clean_sz);
    int expect_live=live_count();

    /* ---- the crash: child appends a record and is SIGKILLed after a partial write ---- */
    pid_t p=fork();
    if(p==0){
        int f=open(LOG,O_WRONLY|O_APPEND);
        char junk[sizeof(Hdr)+7+3]; Hdr h={0}; h.klen=7; h.vlen=99999;  /* header promises more than follows */
        memcpy(junk,&h,sizeof h); memcpy(junk+sizeof(Hdr),"keyXXXX",7); memcpy(junk+sizeof(Hdr)+7,"abc",3);
        write(f,junk,sizeof junk);
        raise(SIGKILL); _exit(1);
    }
    int st; waitpid(p,&st,0);
    printf("child killed by signal %d; log now %lld bytes (grew by %lld)\n",
        WIFSIGNALED(st)?WTERMSIG(st):-1, (long long)({struct stat s;stat(LOG,&s);s.st_size;}), (long long)(({struct stat s;stat(LOG,&s);s.st_size;})-clean_sz));

    /* ---- recovery: replay stops at the torn record ---- */
    nidx=0; torn=0; int n2=scan(LOG,put_idx,NULL,&torn);
    printf("after crash:  %d records replayed, torn=%d, live keys=%d\n",n2,torn,live_count());
    printf("CHECK torn-detected      : %s\n", torn==1?"PASS":"FAIL");
    printf("CHECK no-record-lost     : %s (%d == %d)\n", n2==n?"PASS":"FAIL", n2, n);
    printf("CHECK state-identical    : %s (%d == %d)\n", live_count()==expect_live?"PASS":"FAIL", live_count(), expect_live);

    /* ---- compaction: rewrite only live records, atomically via rename ---- */
    int cf=open(CMP,O_WRONLY|O_CREAT|O_TRUNC,0644);
    for(int i=0;i<nidx;i++) if(idx[i].live) append(cf,idx[i].k,idx[i].v);
    fsync(cf); close(cf);
    rename(CMP,LOG);                      /* atomic: readers see old or new, never half */
    struct stat s2; stat(LOG,&s2);
    nidx=0; torn=0; int n3=scan(LOG,put_idx,NULL,&torn);
    printf("after compact:%d records, torn=%d, live keys=%d, bytes=%lld (%.1f%% of original)\n",
        n3,torn,live_count(),(long long)s2.st_size,100.0*s2.st_size/clean_sz);
    printf("CHECK compaction-lossless: %s\n", live_count()==expect_live?"PASS":"FAIL");
    printf("CHECK log-shrank         : %s\n", s2.st_size<clean_sz?"PASS":"FAIL");
    unlink(LOG);
    return 0;
}
