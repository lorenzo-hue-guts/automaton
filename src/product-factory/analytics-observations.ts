import { createHmac } from 'node:crypto';
import { ulid } from 'ulid';
import { buildHash } from './build-store.js';
import { canonical,CompanyStore } from './company-store.js';
import { ANALYTICS_CATEGORIES } from './analytics-types.js';
import type { AnalyticsInput,AnalyticsObservation,AnalyticsProvider,AnalyticsScope } from './analytics-types.js';
import { ECONOMIC_METRICS } from './company-economics.js';
const entities=['user','account','customer','anonymous','session','order','subscription'];
const properties=new Set(['channel','campaign','plan','region','version','segment','variant','intervalMonths','recurringAmountCents','latencyMs','error','expansion','contraction','churnReason','firstPurchase']);
const token=/^[\p{L}\p{N}_.:/ -]{1,100}$/u;
/** Indexed queries on the existing DB; never retains native payloads or identifiers. */
export class AnalyticsObservations {
  constructor(readonly store:CompanyStore,private readonly pseudonymKey:string) {if(pseudonymKey.length<32)throw Error('Analytics requires a runtime pseudonym key (not persisted)');const fingerprint=this.pseudonym('analytics-key-version-1');const identity=`analytics:pseudonym-key:${store.creatorAddress}`;const old=store.db.getKV(identity);if(old&&old!==fingerprint)throw Error('Pseudonym key changed; explicit identity migration required to prevent duplicate revenue');if(!old)store.db.setKV(identity,fingerprint);}
  pseudonym(value:string):string {return createHmac('sha256',this.pseudonymKey).update(value).digest('hex');}
  normalize(provider:AnalyticsProvider,raw:unknown,now:Date):AnalyticsObservation {
    const i:AnalyticsInput=provider.normalize(raw),s=provider.source;
    if(!i||typeof i!=='object'||!this.store.db.productFactory.get('products',i.productId)||this.store.db.productFactory.get('products',i.productId)?.creatorAddress!==this.store.creatorAddress)throw Error('INVALID_PRODUCT');
    if(!token.test(i.eventName)||!ANALYTICS_CATEGORIES.includes(i.category)||typeof i.occurredAt!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(i.occurredAt)||!Number.isFinite(Date.parse(i.occurredAt))||Date.parse(i.occurredAt)>now.getTime())throw Error('INVALID_EVENT_TIME_SCHEMA');
    if(i.amountCents!==undefined&&(!Number.isSafeInteger(i.amountCents)||i.amountCents<0||!i.currency)||i.currency!==undefined&&!/^[A-Z]{3}$/.test(i.currency)||i.quantity!==undefined&&(!Number.isSafeInteger(i.quantity)||i.quantity<0))throw Error('INVALID_AMOUNT_CURRENCY');
    if(i.economicMetric&&(!ECONOMIC_METRICS.includes(i.economicMetric)||['netRevenue','contribution','profit'].includes(i.economicMetric)||i.amountCents===undefined))throw Error('INVALID_ECONOMIC_FIELD');
    if(i.paymentStatus&&!['settled','pending','trial'].includes(i.paymentStatus))throw Error('INVALID_PAYMENT_STATE');
    if(i.economicMetric&&['grossRevenue','refunds'].includes(i.economicMetric)&&(i.category!=='COMMERCE'||i.paymentStatus!=='settled'))throw Error('UNSETTLED_REVENUE');
    if(i.correction&&!['refund','chargeback','reversal'].includes(i.correction)||!!i.correction!==!!i.correctionOf||i.correction&&i.economicMetric!=='refunds')throw Error('INVALID_CORRECTION');
    const ids:AnalyticsObservation['identifiers']={};
    for(const [k,v] of Object.entries(i.identifiers??{})){if(!entities.includes(k)||typeof v!=='string'||!v.trim()||v.length>500)throw Error('INVALID_IDENTIFIER');ids[k as keyof typeof ids]=this.pseudonym(`${i.productId}:${k}:${v}`);}
    const props:AnalyticsObservation['properties']={};
    for(const [k,v] of Object.entries(i.properties??{})) {
      if(!properties.has(k))continue; // Minimize: arbitrary text/native fields are never retained.
      if(typeof v==='string'&&(!token.test(v)||/bearer|password|secret|sk-|-----BEGIN|\b\d{13,19}\b/i.test(v))||typeof v==='number'&&!Number.isFinite(v)||!['string','number','boolean'].includes(typeof v))throw Error('UNSAFE_PROPERTY');
      props[k]=v;
    }
    if(props.intervalMonths!==undefined&&(!Number.isInteger(props.intervalMonths)||Number(props.intervalMonths)<1||Number(props.intervalMonths)>12)||props.recurringAmountCents!==undefined&&(!Number.isSafeInteger(props.recurringAmountCents)||Number(props.recurringAmountCents)<0))throw Error('INVALID_SUBSCRIPTION');
    const verification=provider.verify?.(raw,i);
    if(s.nature==='OBSERVED'&&(!verification?.verified||!verification.receiptRef))throw Error('UNVERIFIED_OBSERVATION');
    const normalized={productId:i.productId,eventName:i.eventName,category:i.category,occurredAt:new Date(i.occurredAt).toISOString(),currency:i.currency??null,amountCents:i.amountCents??null,quantity:i.quantity??1,identifiers:ids,properties:props,economicMetric:i.economicMetric??null,paymentStatus:i.paymentStatus??null,correctionOf:i.correctionOf?this.pseudonym(`${s.id}:event:${i.correctionOf}`):null,correction:i.correction??null};
    const payloadHash=buildHash(canonical(normalized));
    if(i.eventId!==undefined&&(typeof i.eventId!=='string'||!i.eventId.trim()||i.eventId.length>500))throw Error('INVALID_EVENT_ID');
    const eventId=i.eventId?this.pseudonym(`${s.id}:event:${i.eventId}`):payloadHash;
    return {id:ulid(),eventId,providerId:s.id,sourceType:s.type,...normalized,receivedAt:now.toISOString(),nature:s.nature,verification:verification?.verified?'VERIFIED':'UNVERIFIED',confidence:s.nature==='OBSERVED'?s.reliability:Math.min(.5,s.reliability),schemaVersion:1,provenance:{sourceId:s.id,receiptHash:this.pseudonym(verification?.receiptRef??payloadHash),payloadHash,trust:'untrusted-external-data'}};
  }
  insert(e:AnalyticsObservation):{duplicate:boolean;observation:AnalyticsObservation} {
    const old=this.store.db.raw.prepare('SELECT content,payload_hash,content_hash FROM analytics_observations WHERE creator_address=? AND provider_id=? AND event_id=?').get(this.store.creatorAddress,e.providerId,e.eventId) as {content:string;payload_hash:string;content_hash:string}|undefined;
    if(old){if(buildHash(old.content)!==old.content_hash)throw Error('OBSERVATION_INTEGRITY');if(old.payload_hash!==e.provenance.payloadHash)throw Error('CONFLICTING_REPLAY');return {duplicate:true,observation:JSON.parse(old.content)};}
    const receipt=this.store.db.raw.prepare('SELECT payload_hash FROM analytics_event_receipts WHERE creator_address=? AND provider_id=? AND event_id=?').get(this.store.creatorAddress,e.providerId,e.eventId) as {payload_hash:string}|undefined;
    if(receipt){if(receipt.payload_hash!==e.provenance.payloadHash)throw Error('CONFLICTING_REPLAY');return {duplicate:true,observation:e};}
    if(e.economicMetric){
      const fact=this.store.db.raw.prepare("SELECT payload_hash,id FROM analytics_event_receipts WHERE creator_address=? AND provider_id=? AND json_extract(identity,'$.economicMetric')=? AND json_extract(identity,'$.receiptHash')=?").get(this.store.creatorAddress,e.providerId,e.economicMetric,e.provenance.receiptHash) as {payload_hash:string;id:string}|undefined;
      if(fact){if(fact.payload_hash!==e.provenance.payloadHash)throw Error('CONFLICTING_FINANCIAL_RECEIPT');return {duplicate:true,observation:e};}
    }
    if(e.correctionOf) {
      const reference=this.store.db.raw.prepare('SELECT identity AS content FROM analytics_event_receipts WHERE creator_address=? AND provider_id=? AND event_id=?').get(this.store.creatorAddress,e.providerId,e.correctionOf) as {content:string}|undefined;
      const payment=reference&&JSON.parse(reference.content) as AnalyticsObservation|undefined;
      if(!payment||payment.productId!==e.productId||payment.currency!==e.currency||payment.economicMetric!=='grossRevenue'||payment.paymentStatus!=='settled')throw Error('INVALID_CORRECTION_REFERENCE');
      const corrections=this.store.db.raw.prepare("SELECT identity AS content FROM analytics_event_receipts WHERE creator_address=? AND provider_id=? AND product_id=? AND json_extract(identity,'$.correctionOf')=?").all(this.store.creatorAddress,e.providerId,e.productId,e.correctionOf) as {content:string}[];
      if(corrections.reduce((sum,r)=>sum+(JSON.parse(r.content).amountCents??0),e.amountCents??0)>(payment.amountCents??0))throw Error('EXCESS_REVERSAL');
    }
    const identity=canonical({productId:e.productId,currency:e.currency,amountCents:e.amountCents,economicMetric:e.economicMetric,paymentStatus:e.paymentStatus,correctionOf:e.correctionOf,receiptHash:e.provenance.receiptHash});
    this.store.db.raw.prepare('INSERT INTO analytics_event_receipts(creator_address,provider_id,event_id,id,product_id,occurred_at,nature,payload_hash,identity) VALUES(?,?,?,?,?,?,?,?,?)').run(this.store.creatorAddress,e.providerId,e.eventId,e.id,e.productId,e.occurredAt,e.nature,e.provenance.payloadHash,identity);
    const content=canonical(e);
    this.store.db.raw.prepare('INSERT INTO analytics_observations(creator_address,provider_id,event_id,id,product_id,occurred_at,received_at,category,nature,payload_hash,content,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(this.store.creatorAddress,e.providerId,e.eventId,e.id,e.productId,e.occurredAt,e.receivedAt,e.category,e.nature,e.provenance.payloadHash,content,buildHash(content));
    return {duplicate:false,observation:e};
  }
  query(scope:AnalyticsScope,limit:number):AnalyticsObservation[] {
    if(!scope.productIds.length)return [];
    const rows=this.store.db.raw.prepare(`SELECT content,content_hash FROM analytics_observations WHERE creator_address=? AND product_id IN (${scope.productIds.map(()=>'?').join(',')}) AND occurred_at>=? AND occurred_at<? AND nature=? ORDER BY occurred_at,id LIMIT ?`).all(this.store.creatorAddress,...scope.productIds,scope.period.start,scope.period.end,scope.nature,limit+1) as {content:string;content_hash:string}[];
    if(rows.length>limit)throw Error('Analytics period event limit exceeded; use bounded periods');
    const missing=this.store.db.raw.prepare(`SELECT COUNT(*) n FROM analytics_event_receipts r LEFT JOIN analytics_observations o ON o.creator_address=r.creator_address AND o.provider_id=r.provider_id AND o.event_id=r.event_id WHERE r.creator_address=? AND r.product_id IN (${scope.productIds.map(()=>'?').join(',')}) AND r.occurred_at>=? AND r.occurred_at<? AND r.nature=? AND o.id IS NULL`).get(this.store.creatorAddress,...scope.productIds,scope.period.start,scope.period.end,scope.nature) as {n:number};
    if(missing.n)throw Error('Raw analytics inputs expired; use frozen aggregates, never reinterpret absence as zero');
    return rows.map(r=>{if(buildHash(r.content)!==r.content_hash)throw Error('OBSERVATION_INTEGRITY');return JSON.parse(r.content) as AnalyticsObservation;}).filter(e=>Object.entries(scope.dimensions??{}).every(([key,value])=>e.properties[key]===value));
  }
}
