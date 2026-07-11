/**
 * 公开页面共享布局（登录 / 注册）
 * 居中容器，最大宽度 md，背景色区分
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
