// Trusted offline toolchain entrypoint; no package manager, shell, network or model commands.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const mode=process.argv[2]||'build';const pkg=JSON.parse(fs.readFileSync('android-project.json','utf8'));
if(!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(pkg.packageId)||!Number.isInteger(pkg.versionCode)||pkg.versionCode<1)throw Error('Invalid Android identity');
const manifest=fs.readFileSync('AndroidManifest.xml','utf8');if(!manifest.includes(`package="${pkg.packageId}"`))throw Error('Manifest identity mismatch');
if(/uses-permission|https?:\/\/|-----BEGIN .*PRIVATE KEY|\bsk-[a-zA-Z0-9]{16,}/.test(manifest.replace('http://schemas.android.com/apk/res/android','')))throw Error('Unapproved Android permission/endpoint/secret');
function run(bin,args,cwd='/work'){const r=cp.spawnSync(bin,args,{cwd,encoding:'utf8',timeout:20000,maxBuffer:200000,env:{PATH:'/usr/lib/jvm/bin',JAVA_HOME:'/usr/lib/jvm',TMPDIR:'/tmp'}});if(r.status!==0)throw Error((r.stderr||r.stdout||String(r.error)).slice(0,5000));return r.stdout;}
const files=[];function walk(d){for(const n of fs.readdirSync(d)){const f=path.join(d,n);if(fs.lstatSync(f).isSymbolicLink())throw Error('Symlink');if(fs.statSync(f).isDirectory())walk(f);else if(f.endsWith('.java'))files.push(f);}}walk('src');
if(!files.length||files.length>30||files.some(f=>/java\.net|Runtime\.|ProcessBuilder|loadLibrary|https?:\/\//.test(fs.readFileSync(f,'utf8'))))throw Error('Unapproved Android source action');
if(mode==='static'){process.stdout.write(JSON.stringify({valid:true,packageId:pkg.packageId}));process.exit(0);}
fs.mkdirSync('classes',{recursive:true});fs.mkdirSync('dex',{recursive:true});fs.mkdirSync('dist',{recursive:true});
run('/usr/lib/jvm/bin/java',['-m','jdk.compiler/com.sun.tools.javac.Main','-source','8','-target','8','-classpath','/sdk/platform/android.jar','-d','classes',...files]);
const classes=[];function cls(d){for(const n of fs.readdirSync(d)){const f=path.join(d,n);if(fs.statSync(f).isDirectory())cls(f);else if(f.endsWith('.class'))classes.push(f);}}cls('classes');
run('/usr/lib/jvm/bin/java',['-cp','/sdk/build-tools/lib/d8.jar','com.android.tools.r8.D8','--lib','/sdk/platform/android.jar','--min-api','26','--output','dex',...classes]);
run('/sdk/build-tools/aapt2',['link','-I','/sdk/platform/android.jar','--manifest','AndroidManifest.xml','--min-sdk-version','26','--target-sdk-version','35','-o','dist/application-unsigned.apk']);
run('/usr/lib/jvm/bin/java',['-m','jdk.jartool/sun.tools.jar.Main','uf','dist/application-unsigned.apk','-C','dex','classes.dex']);
const listing=run('/sdk/build-tools/aapt',['list','dist/application-unsigned.apk']);if(!listing.includes('classes.dex')||!listing.includes('AndroidManifest.xml'))throw Error('Invalid APK contents');
process.stdout.write(JSON.stringify({compiled:true,packaged:true,artifact:'dist/application-unsigned.apk',packageId:pkg.packageId,versionCode:pkg.versionCode,signing:'NOT_CONFIGURED',storeReadiness:'NOT_IMPLEMENTED'}));
