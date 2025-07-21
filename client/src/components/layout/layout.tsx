import { ReactNode } from "react";
import { SimpleHeader } from "./simple-header";
import { Footer } from "./footer";
import { useLocation } from "wouter";
import { CategoryMegaMenu } from "./category-mega-menu";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  // Check if we're on a dashboard or orders route (these use DashboardLayout)
  const skipHeaderFooter =
    location.startsWith("/admin") ||
    location.startsWith("/seller/dashboard") ||
    location.startsWith("/buyer/dashboard") ||
    location.startsWith("/orders") ||
    location.startsWith("/order/");

  // We've removed the old CategoryNav components from product pages
  // Now using only the CategoryMegaMenu for consistent category navigation
  // This is the single source of category navigation across the site

  // Show CategoryMegaMenu only on home, category, and seller products listing pages
  const showCategoryMegaMenu =
    !skipHeaderFooter &&
    (location === "/" ||
      location.startsWith("/category") ||
      location.startsWith("/seller-products-listing"));

  // Standard layout - Show header and footer except for dashboard and orders routes
  return (
    <div className="min-h-screen flex flex-col">
      {!skipHeaderFooter && <SimpleHeader />}
      {/* Removed spacer divs here to eliminate extra space below navbar */}
      {/* Show CategoryMegaMenu only on selected pages */}
      {showCategoryMegaMenu && <CategoryMegaMenu />}
      <main className="flex-grow">{children}</main>
      {!skipHeaderFooter && <Footer />}
    </div>
  );
}
