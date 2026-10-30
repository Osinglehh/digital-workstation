import type { IconName } from './types';

// 开源仓库入口：标题栏、仓库横条、帮助节点与欢迎卡片共用
export const REPO_URL = 'https://github.com/Osinglehh/digital-workstation';
export const REPO_LABEL = 'GitHub 开源仓库 · 欢迎 Star';

// 宣传视频入口：抖音与小红书，点击在新窗口打开
export const VIDEO_LINKS: ReadonlyArray<{
  id: 'douyin' | 'xiaohongshu';
  label: string;
  title: string;
  url: string;
  icon: IconName;
}> = [
  {
    id: 'douyin',
    label: '抖音视频',
    title: '抖音 · 数字工位宣传视频',
    url: 'https://v.douyin.com/KQAS2eHl17M/',
    icon: 'douyin',
  },
  {
    id: 'xiaohongshu',
    label: '小红书视频',
    title: '小红书 · 数字工位宣传视频',
    url: 'https://www.xiaohongshu.com/discovery/item/6ae209e40000000028023016?source=webshare&xhsshare=pc_web&xsec_token=ABlabMqoEDA83lM6G96VkI3pcSGqbugpuaqY8xzHSALvc=&xsec_source=pc_share',
    icon: 'xiaohongshu',
  },
];
