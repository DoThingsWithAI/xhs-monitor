/** Selectors confirmed against one user-supplied rendered goods-detail HTML snapshot.
 * Not proof these selectors are universal or that live automatic access is permitted.
 */
export const XHS_GOODS_SELECTORS = {
  title: '.goods-name',
  sales: '.price-container .spu-text',
  price: '.price-container .price',
  shop: '.seller-container .seller-name',
  shopRating: '.seller-container .score-text',
  shopStats: '.seller-container .name-info .sub-title',
} as const;

export const XHS_GOODS_LEGACY_DEFAULT_SELECTORS =
  { title: 'h1', sales: '', price: '', shop: '' } as const;
