import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {it,expect} from 'vitest';
import {createDatabase} from '../../state/database.js';import {FactoryAnalytics,CompanyStore} from '../../product-factory/index.js';import {analyticsFixture} from './fixtures/analytics-fixture.js';
it('5R25 — multi-product economic intelligence flows into Company Scorecard/Review/forecast/capital and survives restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'analytics-e2e-'));let db=createDatabase(path.join(dir,'db'));
  try {
    const x=analyticsFixture(db),products=[x.product,x.f.product(),x.f.product()],accounting=x.f.opportunity('Analytics accounting',false);
    x.f.setNow('2026-09-29T12:00:00Z');x.f.target('target',20000,x.period.start,x.period.end);x.f.setNow('2026-10-08T12:00:00Z');
    const values=[{gross:1000,cost:600,model:0,retained:2},{gross:800,cost:100,model:0,retained:8},{gross:5000,cost:4000,model:2000,retained:5}],trace:any[]=[];
    for(let p=0;p<products.length;p++){
      const productId=products[p],v=values[p],events=[];
      for(let i=0;i<10;i++){
        const customer=`p${p}-c${i}`;events.push(x.event('grossRevenue',v.gross/10,{productId,identifiers:{customer,user:customer},occurredAt:'2026-10-01T12:00:00Z'}));
        events.push(x.event(undefined,0,{productId,eventName:'signup',identifiers:{customer,user:customer},occurredAt:'2026-10-01T11:00:00Z'}));
        events.push(x.event(undefined,0,{productId,eventName:'activate',category:'ACTIVATION',identifiers:{customer,user:customer},occurredAt:'2026-10-01T11:30:00Z'}));
        if(i<v.retained)events.push(x.event(undefined,0,{productId,eventName:'return',category:'RETENTION',identifiers:{customer,user:customer},occurredAt:'2026-10-06T12:00:00Z'}));
      }
      events.push(x.event('acquisitionCost',v.cost,{productId}),x.event('modelCost',v.model,{productId}));if(p===0){events.push(events[0]);events.push(x.event('refunds',200,{productId,correction:'refund',correctionOf:events[0].eventId,amountCents:50}));}
      x.ingest(events,'billing',productId);
      if(p===0)x.ingest([x.event('grossRevenue',1140,{productId})],'tracker',productId,[]);
      const scope=x.scope([productId]),key=`product-${p}`,r=x.analytics.report(key,scope);
      x.analytics.funnelDefinition(`f-${p}`,{productId,entity:'user',steps:[{name:'signup',eventName:'signup'},{name:'activation',eventName:'activate'},{name:'purchase',eventName:'payment'}],windowMs:86400000,firstValueStep:'activation',changeReason:'Primary user-to-purchase journey'});const funnel=x.analytics.funnel(`fr-${p}`,`f-${p}`,r.key);
      x.analytics.cohortDefinition(`c-${p}`,{productId,entity:'user',entryEvent:'signup',returnEvents:['return'],kind:'activity',groupBy:'entry_day',observationWindowMs:3*86400000,changeReason:'Three-day activity retention, not renewal'});const cohort=x.analytics.cohorts(`cr-${p}`,`c-${p}`,r.key);
      x.analytics.attribution(`a-${p}`,{productId,entity:'customer',model:'UNKNOWN',windowMs:86400000,reliable:false,changeReason:'No reliable campaign attribution'});const units=x.analytics.units(`u-${p}`,`a-${p}`,r.key);
      const enriched=x.analytics.enrich(r.key,{funnelKey:funnel.key,cohortKey:cohort.key,unitsKey:units.key});const snapshot=x.analytics.publish(r.key,`snapshot-${p}`,accounting);x.analytics.dossier(`dossier-${p}`,r.key,snapshot.key);x.analytics.health(r.key);
      trace.push({productId,gross:snapshot.body.metrics.grossRevenue.value,profit:snapshot.body.metrics.profit.value,retention:enriched.body.metrics.retention.value,cac:units.body.cac.value,reportHash:enriched.hash});
    }
    expect(trace.map(t=>t.retention)).toEqual([.2,.8,.5]);expect(trace[1].profit).toBeGreaterThan(trace[0].profit);expect(trace[2].profit).toBeLessThan(0);
    const portfolio=x.analytics.report('portfolio',x.scope(products)),bindings={grossRevenue:{key:'gross',revision:1}},snapshot=x.analytics.publish(portfolio.key,'portfolio-snapshot',accounting,bindings);
    const diagnosis=x.analytics.diagnosis('portfolio-diagnosis',portfolio.key);const dossier=x.analytics.dossier('judge-dossier',portfolio.key,snapshot.key,diagnosis.key);
    // Comparable historical period collected via the same verified read-only contract.
    const past={start:'2026-09-24T00:00:00.000Z',end:'2026-10-01T00:00:00.000Z'};
    for(const productId of products)x.analytics.ingest('billing',{events:[x.event('grossRevenue',500,{productId,occurredAt:'2026-09-27T12:00:00Z'})],cursor:'history',coverage:[{productId,period:past,metrics:x.coverageMetrics,complete:true}]});
    x.analytics.report('previous',{...x.scope(products),period:past});const f=x.f.forecast('manual',1000,1500,x.period.start,x.period.end);x.analytics.forecast('analytics-forecast',['previous','portfolio'],f);
    const scorecard=x.f.os.scorecard('company-scorecard',snapshot.key,'target','analytics-forecast');const review=x.f.os.review('weekly',{type:'weekly',targetKey:'target',snapshotKey:snapshot.key,forecastKey:'analytics-forecast',assessments:x.f.assessments(),stopDoing:['Do not prefer gross revenue over contribution'],priorities:['Improve retention for A; protect B; investigate C cost']});
    expect(review.body.targetOutcome).toBe('MISSED');expect(review.body.dossier.analytics?.eventHashes.length).toBeGreaterThan(0);expect(scorecard.body.analytics?.reportRevision).toBe(portfolio.revision);expect(scorecard.body.revenueGap?.low).toBeGreaterThan(0);
    const intelligence=x.analytics.portfolioIntelligence(['product-0','product-1','product-2']);expect(intelligence[2].metrics.profit.value).toBeLessThan(0);const capital=x.analytics.capitalIntelligence('product-1','u-1');
    for(let i=0;i<products.length;i++){const e=x.f.os.store.get('economicSnapshot',`snapshot-${i}`)!.body.metrics.grossRevenue.evidenceIds;x.f.proposal(`proposal-${i}`,products[i],Math.max(0,trace[i].profit)*10,1000,2,e);}
    const ranking=x.f.os.capitalComparisons(['proposal-0','proposal-1','proposal-2']);expect(ranking[0].key).toBe('proposal-1');expect(ranking.find(r=>r.key==='proposal-2')!.eligible).toBe(false);
    const before=x.f.factory.resources.config.operationalBudgetCents;x.f.setNow('2026-10-10T12:00:00Z');const stale=x.analytics.report('stale',x.scope([products[0]]));expect(stale.body.quality.stale).toBe(true);expect(x.f.factory.resources.config.operationalBudgetCents).toBe(before);
    const artifact={simulation:true,realEconomicSuccessDemonstrated:false,model:'Deterministic read-only SDK/verification contract doubles',products:trace,targetOutcome:review.body.targetOutcome,revenueGap:scorecard.body.revenueGap,chosenCapitalProposal:ranking[0].key,stale:stale.body.quality.stale,reportHash:portfolio.hash,reviewHash:review.hash,dossierHash:dossier.hash,capitalConfidence:capital.confidence};fs.writeFileSync('/tmp/lot-5r-e2e-results.json',JSON.stringify(artifact,null,2));
    db.close();db=createDatabase(path.join(dir,'db'));const store=new CompanyStore(db,'creator');expect(store.get('review','weekly')?.hash).toBe(review.hash);expect(store.get('analyticsDossier','judge-dossier')?.hash).toBe(dossier.hash);expect(store.list('analyticsFunnel')).toHaveLength(3);expect(store.list('analyticsCohort')).toHaveLength(3);expect(store.list('analyticsUnits')).toHaveLength(3);expect(store.get('analyticsProvider','billing')?.body.cursor).toBe('history');expect(store.get('economicSnapshot','portfolio-snapshot')?.hash).toBe(snapshot.hash);
  } finally {if(db.raw.open)db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
