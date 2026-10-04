import type { CatalogGame } from "./catalog.ts";
import { identityNames } from "./game-names.ts";
import { nameKey } from "./game-identity.ts";
export type Membership = { id:string; entityId?:string; names:string[]; ipIds:string[]; evidence:"entity"|"official" };
export function membershipResolver(records:Membership[]) {
  const ids=new Map<string,Membership>(), names=new Map<string,Set<Membership>>();
  for(const record of records){ids.set(record.id,record);if(record.entityId)ids.set(record.entityId,record);for(const name of record.names){const key=nameKey(name);if(!key)continue;const set=names.get(key)||new Set();set.add(record);names.set(key,set);}}
  return (game:CatalogGame):CatalogGame=>{
    let match=ids.get(game.entityId||game.id);
    if(!match){const hits=new Set(identityNames(game).flatMap(n=>[...names.get(nameKey(n))||[]]));if(hits.size===1)match=[...hits][0];}
    return {...game,ipIds:match?.ipIds||[],ipEvidence:match?.evidence,entityId:game.entityId||match?.entityId};
  };
}
