import type { Config } from 'tailwindcss';

// 宝蓝（主色）：主按钮 / 链接 / 激活态
const brand = {
  50: '#EFF6FC',
  100: '#D9EAF8',
  200: '#B3D4F0',
  300: '#7FB5E4',
  400: '#5497D1',
  500: '#3D7DCA',
  600: '#2A75BB',
  700: '#1F5C96',
  800: '#17456F',
  900: '#0F2E4A',
} as const;

// Pokemon 黄（点缀）：激活导航短条 / 徽章 / 高亮，不做大面积填充与正文文字
const accent = {
  50: '#FFFBEB',
  100: '#FFF6C9',
  200: '#FFED8F',
  300: '#FFDF52',
  400: '#FFCB05',
  500: '#F2B90A',
  600: '#D99E00',
  700: '#A67800',
  800: '#7A5900',
  900: '#523B00',
} as const;

// 深海军蓝（墨色）：标题文字 / 深色区块
const navy = {
  50: '#F0F6FB',
  100: '#DCE9F4',
  200: '#B9D3E8',
  300: '#8AB0D2',
  400: '#5A86AE',
  500: '#33608A',
  600: '#1D4A78',
  700: '#003A70',
  800: '#002C56',
  900: '#00203F',
  950: '#001429',
} as const;

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: { brand, accent, navy },
      fontFamily: {
        // 中文界面使用系统字体栈，不加载网络字体
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans CJK SC"',
          '"Source Han Sans SC"',
          'sans-serif',
        ],
      },
      borderRadius: {
        card: '1rem',
        control: '0.75rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 58 112 / 0.05), 0 4px 16px rgb(0 58 112 / 0.06)',
        pop: '0 8px 30px rgb(0 58 112 / 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
