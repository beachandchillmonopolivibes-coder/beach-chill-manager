'use strict';
const CACHE_NAME='beach-chill-glow-v13-3-1';
const CORE=['./vendor/supabase.js?v=13.3.1','./','./index.html','./style.css?v=13.3.1','./hmi-v10.css?v=13.3.1','./professional.css?v=13.3.1','./arena.css?v=13.3.1','./app.js?v=13.3.1','./engine.js?v=13.3.1','./db.js?v=13.3.1','./config.js?v=13.3.1','./manifest.webmanifest','./beach-chill-logo.png','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
const assets=new Set(CORE.map(path=>new URL(path,self.location.href).href));
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(CORE)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('beach-chill-') && key!==CACHE_NAME).map(key=>caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET' || url.origin!==self.location.origin) return;
 // Public runtime configuration is network-first like app assets. Keeping it offline
 // prevents a configured admin app from accidentally falling back to local demo mode.
 if(request.mode==='navigate') {
  event.respondWith(fetch(request).catch(()=>caches.match(new URL('./index.html',self.location.href).href)));
  return;
 }
 if(!assets.has(url.href)) return;
 event.respondWith(fetch(request).then(response=>{
  if(response.ok) { const copy=response.clone(); event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))); }
  return response;
 }).catch(async()=> (await caches.match(request)) || Response.error()));
});
