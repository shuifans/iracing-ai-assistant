import { NextResponse, type NextRequest } from 'next/server';

// 本站不使用 Server Action：src/ 下没有任何 'use server' 函数，构建产物
// server-reference-manifest.json 的 node/edge 均为空对象，所有交互都走 /api/* route handler。
//
// 因此任何携带 `next-action` 请求头的调用都**不可能**命中合法 action，只会让 Next
// 路由层抛 `Failed to find Server Action "<id>"` 并写一条 500 error 日志。实测这类请求
// 来自外部对 Next.js server-action 漏洞的探测（fuzz `next-action: x` 等），与部署一致性无关。
//
// 在路由层之前短路：直接 404，既不抛 500 污染 error 日志，也不向探测回显更多信息。
// 注意：若未来引入真正的 Server Action，必须同步移除或收紧本拦截，否则合法调用会被误伤。
export function middleware(request: NextRequest) {
  if (request.headers.has('next-action')) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  // 跳过静态资源/图片/favicon；其余路径仅读一个 header，开销可忽略。
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
