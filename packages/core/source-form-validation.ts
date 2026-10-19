/**
 * UI and API validation for the source activation form.
 * Passing form checks is NOT proof that a third party actually granted access.
 */
export type SourceFormInput={
 enabled:boolean;
 automated_access_allowed:boolean;
 storage_allowed:boolean;
 analysis_allowed:boolean;
 permission_basis:string;
 titleSelector:string;
 salesSelector:string;
};
export function validateSourceForm(form:SourceFormInput):string[]{
 if(!form.enabled)return []; // Save a disabled draft without authorization requirements.
 const problems:string[]=[];
 if(!form.automated_access_allowed)problems.push('未确认自动访问许可');
 if(!form.storage_allowed)problems.push('未确认数据存储许可');
 if(!form.analysis_allowed)problems.push('未确认内部分析许可');
 if((form.permission_basis||'').trim().length<12)
  problems.push('授权依据不足 12 个字符（请填写真实的许可提供方、范围和依据，不要虚构）');
 if(!(form.titleSelector||'').trim())problems.push('商品标题 CSS 选择器不能为空');
 if(!(form.salesSelector||'').trim())problems.push('商品销量 CSS 选择器不能为空');
 return problems;
}
