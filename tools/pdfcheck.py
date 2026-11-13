import sys,re,os,glob
TS_OID=bytes.fromhex("060b2a864886f70d010910020e")  # id-aa-timeStampToken
def chk(p):
    b=open(p,'rb').read()
    m=re.search(rb'pdfaid:part[>=" ]+(\d)',b); c=re.search(rb'pdfaid:conformance[>=" ]+([A-Za-z])',b)
    pdfa=(m.group(1).decode()+(c.group(1).decode().lower() if c else '')) if m else '-'
    subs=re.findall(rb'/SubFilter\s*/([A-Za-z0-9.]+)',b)
    sigs=[s.decode() for s in subs if b'RFC3161' not in s]; dts=[s for s in subs if b'RFC3161' in s]
    emb=0
    for h in re.findall(rb'/Contents\s*<([0-9A-Fa-f]{2000,})>',b):
        try:
            if TS_OID in bytes.fromhex(h.decode()[:len(h)//2*2]): emb+=1
        except Exception: pass
    return pdfa,len(sigs),len(dts),emb
rows=[]
for p in sorted(glob.glob(sys.argv[1]+'/**/*.[pP][dD][fF]',recursive=True)):
    rows.append((os.path.relpath(p,sys.argv[1]),)+chk(p))
for r in rows: print("%-4s sig=%d docTS=%d sigTS=%d  %s"%(r[1],r[2],r[3],r[4],r[0]))
