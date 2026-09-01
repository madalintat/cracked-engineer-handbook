/* Durability: process death vs power loss. */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <sys/wait.h>
#include <sys/stat.h>
static double now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec/1e9;}

/* child writes N records then dies by _exit (a *process* crash, not a power cut) */
static void child(const char*path,int n,int do_fsync){
    int fd=open(path,O_RDWR|O_CREAT|O_TRUNC,0644);
    for(int i=0;i<n;i++){ char rec[64]; snprintf(rec,sizeof rec,"record-%06d\n",i); write(fd,rec,strlen(rec)); }
    if(do_fsync) fsync(fd);
    _exit(0);            /* no close(), no exit handlers, no flush */
}
static int count_records(const char*path){
    FILE*f=fopen(path,"r"); if(!f) return -1; int c=0; char l[128];
    while(fgets(l,sizeof l,f)) c++; fclose(f); return c;
}
int main(void){
    const char*P="/app/dur.bin"; const int N=5000;
    for(int mode=0;mode<2;mode++){
        pid_t p=fork(); if(p==0) child(P,N,mode); int st; waitpid(p,&st,0);
        printf("%-12s after process death: %d/%d records readable\n", mode?"WITH fsync":"NO fsync", count_records(P), N);
    }
    /* the real difference fsync makes is TIME, i.e. it actually went to the platter */
    for(int mode=0;mode<2;mode++){
        int fd=open(P,O_RDWR|O_CREAT|O_TRUNC,0644);
        double t0=now();
        for(int i=0;i<200;i++){ char rec[64]; int k=snprintf(rec,sizeof rec,"record-%06d\n",i);
            write(fd,rec,k); if(mode) fdatasync(fd); }
        double t1=now();
        printf("%-12s 200 appends: %8.2f ms  (%7.3f ms/append)\n", mode?"WITH fsync":"NO fsync",(t1-t0)*1e3,(t1-t0)*1e3/200);
        close(fd);
    }
    /* and on tmpfs, fsync is free -- because there is no device under it */
    { int fd=open("/tmp/dur.bin",O_RDWR|O_CREAT|O_TRUNC,0644); double t0=now();
      for(int i=0;i<200;i++){ char rec[64]; int k=snprintf(rec,sizeof rec,"r-%06d\n",i); write(fd,rec,k); fdatasync(fd);} double t1=now();
      printf("%-12s 200 appends: %8.2f ms  (tmpfs: fsync has nothing to flush)\n","WITH fsync",(t1-t0)*1e3); close(fd);}
    unlink(P);
    return 0;
}
