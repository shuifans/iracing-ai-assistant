/**
 * 公开页面共享布局（登录 / 注册）
 * 居中容器，最大宽度 md，浅品牌渐变背景
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50/70 to-white px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
