// Only verified complete package payloads are installed. No road data goes to GitHub.
export function openRoadStore(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open('navigator-road-packages',1);
 request.onupgradeneeded=()=>{for(const name of ['meta','payload','settings'])request.result.createObjectStore(name,{keyPath:'id'});};
 request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Road storage is blocked by another tab.'));
 request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();
 const operation=(names,mode,fn)=>new Promise((yes,no)=>{const tx=db.transaction(names,mode);let result;try{result=fn(tx);}catch(e){tx.abort();no(e);return;}tx.oncomplete=()=>yes(result?.result);tx.onerror=tx.onabort=()=>no(tx.error||new Error('Road storage transaction failed.'));});
 resolve({list:()=>operation(['meta'],'readonly',tx=>tx.objectStore('meta').getAll()),get:id=>operation(['payload'],'readonly',tx=>tx.objectStore('payload').get(id)),setting:id=>operation(['settings'],'readonly',tx=>tx.objectStore('settings').get(id)),save:value=>operation(['settings'],'readwrite',tx=>tx.objectStore('settings').put(value)),put:(meta,payload)=>operation(['meta','payload'],'readwrite',tx=>{tx.objectStore('meta').put(meta);tx.objectStore('payload').put({id:meta.id,...payload});}),remove:id=>operation(['meta','payload'],'readwrite',tx=>{tx.objectStore('meta').delete(id);tx.objectStore('payload').delete(id);}),clear:()=>operation(['meta','payload','settings'],'readwrite',tx=>{for(const name of ['meta','payload','settings'])tx.objectStore(name).clear();}),close:()=>db.close()});};
});}
