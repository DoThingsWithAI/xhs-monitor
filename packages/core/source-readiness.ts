/** Explain why a configured browser source is not ready to schedule.
 * This diagnostic never grants access or alters permission flags.
 */
export type SourceReadiness = {
  enabled: number|boolean;
  automated_access_allowed: number|boolean;
  storage_allowed: number|boolean;
  analysis_allowed: number|boolean;
  permission_basis: string|null;
  permission_expires_at?: number|null;
  selectors_json: string;
};

export function sourceBlockingReason(source:SourceReadiness|null|undefined,now=Date.now()):string|null{
  if(!source)return '没有配置可用的数据源';
  if(!source.enabled)return '数据源尚未启用（默认关闭）';
  if(!source.automated_access_allowed)return '尚未确认该来源允许自动访问';
  if(!source.storage_allowed)return '尚未确认该来源允许存储数据';
  if(!source.analysis_allowed)return '尚未确认该来源允许内部分析';
  if(!source.permission_basis || source.permission_basis.trim().length<12)
    return '需要有效的授权依据，不能仅靠勾选开关';
  if(source.permission_expires_at!==null && source.permission_expires_at!==undefined &&
     source.permission_expires_at<=now)return '数据源授权已过期';
  let selectors:Record<string,unknown>;
  try{selectors=JSON.parse(source.selectors_json);}
  catch{return 'CSS 字段选择器配置无法解析';}
  if(typeof selectors.title!=='string'||!selectors.title.trim()||
     typeof selectors.sales!=='string'||!selectors.sales.trim())
     return '缺少商品标题或商品销量的选择器';
  return null;
}
