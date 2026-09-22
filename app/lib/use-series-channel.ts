"use client";
import { useEffect, useState } from "react";
import { publicData } from "./public-data";
import type { SeriesChannel } from "./series-types";
const cache=new Map<string,SeriesChannel>();
export function useSeriesChannel(id:string){
  const [channel,setChannel]=useState<SeriesChannel|null>(cache.get(id)||null);const [state,setState]=useState("loading");const [attempt,setAttempt]=useState(0);
  useEffect(()=>{const run=new AbortController();const timer=setTimeout(()=>{setChannel(cache.get(id)||null);setState("loading");void publicData<SeriesChannel>("series/"+id+".json",run.signal).then(data=>{if(data.id!==id||!Array.isArray(data.games))throw new Error("Invalid channel");if(!run.signal.aborted){if(cache.size>20)cache.delete(cache.keys().next().value!);cache.set(id,data);setChannel(data);setState("ready");}}).catch(()=>{if(!run.signal.aborted)setState("error");});},0);return()=>{clearTimeout(timer);run.abort();};},[id,attempt]);
  return {channel,state,retry:()=>setAttempt(n=>n+1)};
}
