/** Conservative spacing for sources where automated access is explicitly permitted.
 * Rate limits are not permission; slower requests do not grant authorization.
 */
export const DEFAULT_SOURCE_GAP_SECONDS=120;
export const MIN_SOURCE_GAP_SECONDS=60;
export const MAX_SOURCE_GAP_SECONDS=3600;

export function parseSourceGapSeconds(raw:string|undefined):number{
 if(raw===undefined || raw.trim()==='')return DEFAULT_SOURCE_GAP_SECONDS;
 if(!/^\d+$/.test(raw.trim()))return DEFAULT_SOURCE_GAP_SECONDS;
 const value=Number(raw.trim());
 if(!Number.isSafeInteger(value))return DEFAULT_SOURCE_GAP_SECONDS;
 return Math.min(MAX_SOURCE_GAP_SECONDS,Math.max(MIN_SOURCE_GAP_SECONDS,value));
}
export function sourceGapMs():number{
 return parseSourceGapSeconds(process.env.XHS_SOURCE_MIN_GAP_SECONDS)*1000;
}
