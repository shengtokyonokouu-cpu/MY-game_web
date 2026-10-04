export const LOCAL_FOLLOWS_KEY="release-signal-local-follows-v1";
export function decodeLocalFollows(raw:string|null):string[] {
  if(!raw)return [];
  const data=JSON.parse(raw);
  if(data?.version!==1||!Array.isArray(data.following)||data.following.length>1000||data.following.some((id:unknown)=>typeof id!=="string"||!/^[a-z0-9-]{1,100}$/.test(id)))throw new Error("本机关注记录无法读取；已保留原始数据，未覆盖。");
  return [...new Set<string>(data.following)];
}
export const encodeLocalFollows=(following:string[])=>JSON.stringify({version:1,following});
