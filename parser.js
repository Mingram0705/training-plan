/* Workout text parser: turns OCR / pasted text into exercises + sets. No dependencies, runs offline.
   parseWorkoutText(text, {exercises:[{name,kind}], today:Date}) -> {exercises, date, dayNum, title, sections, lines}
   kind: w = kg x reps, b = reps only, s = seconds, m = minutes */
(function(root){
"use strict";
const MON={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
const MON_RE="(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";
const LB=0.45359237;
const r05=x=>Math.round(x*2)/2;

/* ---------- fuzzy name matching ---------- */
const TOKEN_ALIAS={db:"dumbbell",dumbell:"dumbbell",dumbel:"dumbbell",bb:"barbell",rdl:"romanian deadlift",rdls:"romanian deadlift",
 ohp:"shoulder press",tri:"tricep",tris:"tricep",triceps:"tricep",bi:"bicep",bis:"bicep",biceps:"bicep",ext:"extension",exts:"extension",
 pulldown:"lat pulldown",pulldowns:"lat pulldown",pushdowns:"pushdown",flye:"fly",flyes:"fly",flies:"fly",ham:"hamstring",
 lats:"lat",squats:"squat",curls:"curl",raises:"raise",rows:"row",presses:"press",extensions:"extension",lunges:"lunge",
 hipthrust:"hip thrust",ohe:"overhead tricep extension",pallof:"pallof"};
const EQUIP=["barbell","dumbbell","cable","machine","smith","kettlebell","band","bodyweight"];
function normName(s){return String(s||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim()}
const WHOLE_ALIAS={"bench":"bench press barbell","flat bench":"bench press barbell","incline":"incline bench press","incline db":"incline bench press dumbbell","row":"barbell row","bb row":"barbell row","rdl":"romanian deadlift","ohp":"shoulder press","shoulder press":"seated shoulder press","pulldown":"lat pulldown","lat pull down":"lat pulldown","pushdown":"tricep pushdown","fly":"chest fly","flys":"chest fly","cable fly":"chest fly cable","laterals":"lateral raise","side raise":"lateral raise","hip thrust":"glute bridge hip thrust","glute bridge":"glute bridge hip thrust","bike":"cardio bike","cycling":"cardio bike","cardio":"cardio"};
function tokens(s){const n=normName(s);s=WHOLE_ALIAS[n]||n;return normName(s).split(" ").filter(Boolean).flatMap(t=>(TOKEN_ALIAS[t]||t).split(" ")).map(t=>t.length>4&&t.endsWith("s")&&!t.endsWith("ss")?t.slice(0,-1):t)}
function lev(a,b){if(a===b)return 0;const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=Array.from({length:n+1},(_,j)=>j);
 for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}return p[n]}
function ratio(a,b){const L=Math.max(a.length,b.length);return L?1-lev(a,b)/L:1}
function tokScore(rt,ct){if(!rt.length||!ct.length)return 0;let sum=0;const used=new Set();
 ct.forEach(c=>{let best=0,bi=-1;rt.forEach((r,i)=>{if(used.has(i))return;const v=ratio(r,c);if(v>best){best=v;bi=i}});if(best>=0.6){used.add(bi);sum+=best}});
 return sum/Math.max(rt.length,ct.length)}
function scoreName(raw,cand){
 const rt=tokens(raw),full=tokens(cand),base=tokens(String(cand).replace(/\(.*?\)/g," "));
 const rj=rt.join(" "),s1=ratio(rj,full.join(" ")),s2=ratio(rj,base.join(" "))*0.97;
 const t1=tokScore(rt,full),t2=tokScore(rt.filter(t=>!EQUIP.includes(t)),base)*0.97;
 let s=Math.max(s1,s2,t1,t2);
 const re=rt.filter(t=>EQUIP.includes(t)),ce=full.filter(t=>EQUIP.includes(t));
 if(re.length&&ce.length){if(re.some(t=>ce.includes(t)))s=Math.min(1,s+0.03);else s-=0.15}
 return Math.max(0,s)}
function matchExercise(raw,list){
 const sc=list.map(e=>({name:e.name,kind:e.kind,score:scoreName(raw,e.name)})).sort((a,b)=>b.score-a.score);
 const best=sc[0],second=sc[1];if(!best)return{match:null,conf:"new",alts:[]};
 const alts=sc.filter(x=>x.score>=0.5).slice(0,4).map(x=>x.name);
 if(best.score>=0.9&&(!second||second.score<best.score-0.025))return{match:best,conf:"ok",alts};
 if(best.score>=0.62)return{match:best,conf:"check",alts,why:second&&second.score>=best.score-0.025?"Could be more than one exercise":"Name didn't read clearly"};
 return{match:null,conf:"new",alts,why:"Not in your plan, saved as a new exercise"}}

/* ---------- line cleanup ---------- */
function cleanLine(l){
 let s=String(l).replace(/[\u2022\u00b7\u2219\u25cf\u25cb\u2027\u30fb]/g," • ").replace(/[×✕✖]/g,"x").replace(/[–—−‒]/g,"-").replace(/[“”]/g,'"').replace(/[‘’]/g,"'");
 s=s.replace(/^\s*(?:[^\w\s(]{1,3}|[eoO0©®]|[«»])\s+(?=[A-Za-z])/,""); // bullets / checkmarks OCR'd as junk
 s=s.replace(/\s+/g," ").trim().replace(/^[lI|]\s*(?=sets?\b)/i,"1 ").replace(/^(\d)(sets?)\b/i,"$1 $2");return s}
function fixOcrDigits(s){ // only used on data parts: 1O0 -> 100, l Set -> 1 Set, 1Set -> 1 Set
 return s.replace(/(\d)[oO](?=\d|\b)/g,"$10").replace(/(\d)[oO](?=\d|\b)/g,"$10").replace(/\b[lI|](?=\s*sets?\b)/gi,"1").replace(/(\d)(sets?|reps?|secs?|kg|lbs?)\b/gi,"$1 $2")
  .replace(/(\d)\s*[*]\s*(\d)/g,"$1 x $2").replace(/(\d)\s*[xX]\s*(?=\d)/g,"$1 x ").replace(/\bx(\d)/gi,"x $1")}
const NOISE=/^(start workout|continue to week|generate new plan|ready for next week|roadmap|nutrition|settings|edit|log|progress|music|workouts?)\b|\bweek streak\b|^week \d+$/i;

/* ---------- dates ---------- */
function inferYear(m,d,today){let y=today.getFullYear();const dt=new Date(y,m,d);if(dt-today>86400000*2)y--;return y}
function iso(y,m,d){return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`}
function parseDate(line,today){const s=line.toLowerCase();let m;
 if((m=s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)))return iso(+m[1],+m[2]-1,+m[3]);
 if((m=s.match(new RegExp("\\b"+MON_RE+"\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?")))){const mo=MON[m[1]];const d=+m[2];if(d>=1&&d<=31)return iso(m[3]?+m[3]:inferYear(mo,d,today),mo,d)}
 if((m=s.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+"+MON_RE+"(?:,?\\s*(\\d{4}))?")))){const mo=MON[m[2]];const d=+m[1];if(d>=1&&d<=31)return iso(m[3]?+m[3]:inferYear(mo,d,today),mo,d)}
 if(/\b(completed|date|done|on)\b/.test(s)&&(m=s.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/))){const d=+m[1],mo=+m[2]-1;if(d<=31&&mo<12){let y=m[3]?+m[3]:inferYear(mo,d,today);if(y<100)y+=2000;return iso(y,mo,d)}}
 return null}
function isDateLine(line){const s=line.toLowerCase();if(!new RegExp("\\b"+MON_RE+"\\b").test(s)&&!/\b\d{4}-\d{1,2}-\d{1,2}\b/.test(s)&&!/\b(completed|date)\b/.test(s))return false;
 return /\b(completed|date|done on|on)\b/.test(s)||s.split(" ").length<=5}

/* ---------- set data ---------- */
const UNIT_RE="(reps?|rep|secs?|seconds?|sec|s|mins?|minutes?|min|m)";
function unitOf(u){u=(u||"").toLowerCase();if(/^s|^sec/.test(u))return"s";if(/^m/.test(u))return"m";return u?"reps":null}
function weightOf(n,u){n=+n;if(/lb/i.test(u||""))return r05(n*LB);return n}
// returns {sets:[[kg|null,val|null]], unit:'reps'|'s'|'m'|null, hasKg, range} or null when the text holds no set data
function parseData(str){
 let s=" "+fixOcrDigits(str.toLowerCase()).replace(/kgs\b/g,"kg").replace(/lbs\b/g,"lb").replace(/pounds?\b/g,"lb").replace(/\bkilos?\b/g,"kg")+" ";
 const done=/\b(done|completed|hit|all reps|✓|✔)\b/.test(s);
 const pickRange=(a,b)=>b!=null&&b!==""&&+b>+a?(done?+b:+a):+a;
 let m,unit=null,kg=null,setsN=null,range=false;
 const W="(\\d+(?:\\.\\d+)?)\\s*(kg|lb)?";
 // 1) "N sets ..." (his old app: "2 Sets • 100 kg x 10 - 12 Reps", "1 Set • 60 Secs", "3 sets of 10 @ 60")
 if((m=s.match(/(\d+)\s*sets?\b/))){
  setsN=+m[1];let rest=s.replace(m[0]," ");
  let w=rest.match(/(\d+(?:\.\d+)?)\s*(kg|lb)\b/)||rest.match(/@\s*(\d+(?:\.\d+)?)\s*(kg|lb)?/);
  if(w){kg=weightOf(w[1],w[2]);rest=rest.replace(w[0]," ")}
  let r=rest.match(new RegExp("(?:x|of)?\\s*(\\d+)\\s*(?:-|to|~)\\s*(\\d+)\\s*"+UNIT_RE+"?\\b"))||rest.match(new RegExp("(?:x|of)\\s*(\\d+)()\\s*"+UNIT_RE+"?\\b"))||rest.match(new RegExp("(\\d+)()\\s*"+UNIT_RE+"\\b"));
  let val=null;if(r){val=pickRange(r[1],r[2]);range=!!r[2];unit=unitOf(r[3])||"reps"}
  if(setsN<1||setsN>20)return null;
  return{sets:Array.from({length:setsN},()=>[kg,val]),unit,hasKg:kg!=null,range,missing:val==null,oddSets:setsN>5}}
 // 2) "80/8 80/8 75/7" or "80x8 80x8 75x7" (two or more weight/reps pairs)
 const pairs=[...s.matchAll(new RegExp(W+"\\s*[\\/x]\\s*(\\d+)(?![\\d.]*\\s*(?:kg|lb))","g"))];
 if(pairs.length>=2&&pairs.every(p=>+p[1]>=+p[3]||p[2])&&!/,\s*\d/.test(s)){
  return{sets:pairs.map(p=>[weightOf(p[1],p[2]),+p[3]]),unit:"reps",hasKg:true}}
 // 3) "AxB" forms: "3x8 80kg", "3 x 10 @ 60", "80kg x 8, 8, 7", "80 x 8", "3 x 60s"
 if((m=s.match(new RegExp(W+"\\s*x\\s*(\\d+)(?:\\s*(?:-|to)\\s*(\\d+))?\\s*"+UNIT_RE+"?((?:\\s*[,/]\\s*\\d+)*)")))){
  const a=+m[1],aUnit=m[2],b=+m[3],bTop=m[4],u=unitOf(m[5]),more=(m[6]||"").split(/[,/]/).map(x=>x.trim()).filter(Boolean).map(Number);
  const rest=s.replace(m[0]," ");
  const w2=rest.match(/(\d+(?:\.\d+)?)\s*(kg|lb)\b/)||rest.match(/@\s*(\d+(?:\.\d+)?)\s*(kg|lb)?/);
  if(aUnit){ // weight x reps[, reps...]
   const reps=[pickRange(b,bTop),...more];return{sets:reps.map(r=>[weightOf(a,aUnit),r]),unit:"reps",hasKg:true,range:!!bTop}}
  if(w2||a<=10){ // sets x reps (@ weight)
   if(more.length&&!w2&&a>10){}else{const n=Math.min(a,20),v=pickRange(b,bTop);const k=w2?weightOf(w2[1],w2[2]):null;
    return{sets:Array.from({length:n},()=>[k,v]),unit:u||"reps",hasKg:k!=null,range:!!bTop}}}
  // weight x reps with no unit ("80 x 8", "80 x 8, 8, 7")
  const reps=[pickRange(b,bTop),...more];return{sets:reps.map(r=>[a,r]),unit:"reps",hasKg:true,range:!!bTop}}
 // 4) "80kg 8, 8, 7" / "80kg for 8"
 if((m=s.match(/(\d+(?:\.\d+)?)\s*(kg|lb)\b\s*(?:for|:|-)?\s*(\d+(?:\s*[,/]\s*\d+)*)\s*(?:reps?)?\b/))){
  const reps=m[3].split(/[,/]/).map(x=>+x.trim()).filter(x=>x>0&&x<100);if(reps.length)return{sets:reps.map(r=>[weightOf(m[1],m[2]),r]),unit:"reps",hasKg:true}}
 // 5) single values "12 reps", "60 secs", "20 min", "10-12 reps"
 if((m=s.match(new RegExp("(\\d+)\\s*(?:(?:-|to)\\s*(\\d+)\\s*)?"+"(reps?|secs?|seconds?|mins?|minutes?)\\b")))){
  return{sets:[[null,pickRange(m[1],m[2])]],unit:unitOf(m[3]),hasKg:false,range:!!m[2]}}
 if((m=s.match(/(\d+(?:\.\d+)?)\s*(kg|lb)\b/)))return{sets:[[weightOf(m[1],m[2]),null]],unit:"reps",hasKg:true,missing:true};
 return null}

/* ---------- main ---------- */
function splitNameData(line){ // "Bench Press 3x8 80kg" -> ["Bench Press","3x8 80kg"]
 const i=line.search(/\d/);if(i<0)return[line,""];if(i===0)return["",line];
 // a digit glued to letters like "5ets" is OCR noise for "Sets"
 let name=line.slice(0,i).replace(/[:\-–—•@(\s]+$/,"").trim();return[name,line.slice(i)]}
const looksLikeName=n=>/[a-z]{3}/i.test(n)&&n.split(" ").length<=6&&n.length<=48&&!/[.?!]$/.test(n)&&!/,\s/.test(n);
function titleCase(s){return s.replace(/\s+/g," ").trim().replace(/\b([a-z])/g,c=>c.toUpperCase())}

function parseWorkoutText(text,opts){
 opts=opts||{};const list=opts.exercises||[],today=opts.today||new Date();
 const lines=String(text||"").split(/\r?\n/).map(cleanLine).filter(Boolean);
 const sections=[];let sec={dayNum:null,title:null,date:null,exercises:[]};sections.push(sec);
 let pending=null,last=null;
 const newEx=(name,line)=>{const mt=matchExercise(name,list);return{raw:name,lines:[line],sets:[],unit:null,hasKg:false,...mt}};
 const flushPending=()=>{if(pending){if(pending.conf==="ok"){sec.exercises.push(pending);pending.missing=true;last=pending}pending=null}};
 const addData=(ex,d,line)=>{ex.sets.push(...d.sets);ex.unit=ex.unit||d.unit;ex.hasKg=ex.hasKg||d.hasKg;if(d.missing)ex.missing=true;if(d.oddSets)ex.oddSets=true;if(!ex.lines.includes(line))ex.lines.push(line)};
 for(const line of lines){
  let m;
  if((m=line.match(/^(?:\S{0,4}\s+)?\W*day\s*([1-9])\b\s*[·•.:\-|]*\s*(.*)$/i))&&!/\b\d+\s*sets?\b/i.test(line)){
   flushPending();sec={dayNum:+m[1],title:("Day "+m[1]+(m[2]?" · "+m[2].replace(/\s+(?:[~v^>»]+|[AV])$/,"").replace(/[~^>»]+$/,"").trim():"")).trim(),date:null,exercises:[]};sections.push(sec);last=null;continue}
  if(isDateLine(line)){const d=parseDate(line,today);if(d){sec.date=sec.date||d;flushPending();continue}}
  if(NOISE.test(line)){flushPending();continue}
  const [namePart,dataPart]=splitNameData(line);
  const data=dataPart?parseData(dataPart):null;
  if(data){
   if(namePart&&looksLikeName(namePart)&&/[a-z]{3}/i.test(namePart)&&!/^(sets?|reps?|x|of|and)$/i.test(namePart)){flushPending();const ex=newEx(namePart,line);addData(ex,data,line);sec.exercises.push(ex);last=ex;continue}
   if(pending){addData(pending,data,line);sec.exercises.push(pending);last=pending;pending=null;continue}
   if(last){addData(last,data,line);continue}
   continue}
  if(!/[a-z]/i.test(line))continue;            // numbers / clock / battery
  if(line.split(" ").length>6||/[.?!]$/.test(line)){flushPending();continue} // sentences / paragraphs
  if(looksLikeName(line)){flushPending();pending=newEx(line,line);continue}
  flushPending()}
 flushPending();
 const withEx=sections.filter(s=>s.exercises.length);
 const exercises=withEx.flatMap(s=>s.exercises);
 exercises.forEach(e=>{
  const kindFromData=e.unit==="s"?"s":e.unit==="m"?"m":e.hasKg?"w":"b";
  e.name=e.match?e.match.name:titleCase(e.raw);
  e.kind=e.match?e.match.kind:kindFromData;
  if(e.match&&(e.unit==="s"||e.unit==="m")&&e.kind==="w")e.kind=e.unit; // timed data beats plan kind
  if(!e.sets.length){e.sets=[[null,null]];e.missing=true}
  if(e.missing&&e.conf==="ok"){e.conf="check";e.why=e.kind==="m"?"Add your minutes":e.kind==="s"?"Add your seconds":"Add your reps"}
  if(e.oddSets&&e.conf==="ok"){e.conf="check";e.why=`${e.sets.length} sets looks unusual. Check the number of sets`}
  e.line=e.lines.join("  /  ")});
 const main=withEx[0]||sections[sections.length-1];
 const dayNum=(withEx.find(s=>s.dayNum)||{}).dayNum||null,title=(withEx.find(s=>s.title)||{}).title||null,date=(withEx.find(s=>s.date)||{}).date||(sections.filter(s=>s.dayNum||s.date).length<=1?(sections.find(s=>s.date)||{}).date:null)||null;
 return{exercises,date,dayNum,title,sections,lines}}

const api={parseWorkoutText,parseData,parseDate,matchExercise,scoreName,cleanLine};
if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.WorkoutParser=api;
})(typeof self!=="undefined"?self:this);
