import styles from './SingleWorkbenchPageNew.module.scss';
import { SidePanel } from '@/ui/components/side-panel/SidePanel.tsx';

export function SingleWorkbenchPageNew() {
  return (<div className={styles.root}>
    <div className={styles.main}>
      <div className={styles.title}>选择职业</div>
    </div>
    {/*<SidePanel title={"信息公告栏"}><div></div></SidePanel>*/}
    <SidePanel title={"骑士"} subtitle={"条件摘要"} showStatus={true} status={"ready"} statusText={"已就绪，搜索结果将严格满足以上条件"} showActionBtn={true} actionBtnText={"开始搜索"}><div></div></SidePanel>
  </div>)
}