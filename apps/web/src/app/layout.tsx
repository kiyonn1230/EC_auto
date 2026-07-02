import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "越境EC 出品ダッシュボード",
  description: "メルカリ仕入れ→Shopify予約販売の社内オペツール",
};

const NAV = [
  { href: "/products", label: "商品一覧" },
  { href: "/import", label: "取込・検証" },
  { href: "/settings", label: "設定" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full bg-gray-50 text-gray-900">
        <div className="flex min-h-screen">
          <aside className="w-52 shrink-0 border-r border-gray-200 bg-white">
            <div className="px-4 py-5 border-b border-gray-200">
              <h1 className="text-sm font-bold leading-tight">
                越境EC<br />出品ダッシュボード
              </h1>
            </div>
            <nav className="p-2 space-y-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded px-3 py-2 text-sm hover:bg-gray-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="flex-1 p-6 overflow-x-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
