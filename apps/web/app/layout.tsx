import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'XHS Monitor · 竞品监控',description:'个人小红书竞品展示指标自动监控后台'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="zh-CN"><body>{children}</body></html>;
}
