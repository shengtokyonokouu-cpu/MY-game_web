"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultRoute, parseRoute, routeURL, type BrowseRoute } from "./browse-route";
export function useBrowseRoute() {
  const [route, setRoute] = useState(defaultRoute), [ready,setReady] = useState(false);
  const current=useRef(route); const scrollTarget=useRef<number|null>(null);
  const update = useCallback((patch: Partial<BrowseRoute>, push = false) => {
    const next={...current.current,...patch};
    // Preserve framework/history metadata and the exact location being left.
    if(push) history.replaceState({...history.state,scrollY:window.scrollY},"",location.href);
    const url=routeURL(next);
    if(url!==location.pathname+location.search) history[push?"pushState":"replaceState"]({...history.state,scrollY:push?0:window.scrollY},"",url);
    current.current=next;setRoute(next);
  },[]);
  useEffect(()=>{
    const prior=history.scrollRestoration; history.scrollRestoration="manual";
    const restore=()=>{const next=parseRoute(location.search);current.current=next;setRoute(next);scrollTarget.current=history.state?.scrollY||0;setReady(true);};
    restore();window.addEventListener("popstate",restore);
    const record=()=>{if(scrollTarget.current===null)history.replaceState({...history.state,scrollY:window.scrollY},"",location.href);};
    let timer:ReturnType<typeof setTimeout>;const onScroll=()=>{clearTimeout(timer);timer=setTimeout(record,150);};
    window.addEventListener("scroll",onScroll,{passive:true}); window.addEventListener("pagehide",record);
    return()=>{history.scrollRestoration=prior;clearTimeout(timer);window.removeEventListener("popstate",restore);window.removeEventListener("scroll",onScroll);window.removeEventListener("pagehide",record);};
  },[]);
  useEffect(()=>{
    if(scrollTarget.current===null)return;
    const restore=()=>{if(scrollTarget.current!==null)window.scrollTo({top:scrollTarget.current,behavior:"instant"});};
    const observer=new ResizeObserver(restore);observer.observe(document.body);const frame=requestAnimationFrame(restore);
    const timer=setTimeout(()=>{restore();scrollTarget.current=null;observer.disconnect();},1500);
    const cancel=()=>{scrollTarget.current=null;observer.disconnect();};window.addEventListener("pointerdown",cancel,{once:true});window.addEventListener("wheel",cancel,{once:true});
    return()=>{cancelAnimationFrame(frame);clearTimeout(timer);observer.disconnect();window.removeEventListener("pointerdown",cancel);window.removeEventListener("wheel",cancel);};
  },[route,ready]);
  return {route,update,ready};
}
