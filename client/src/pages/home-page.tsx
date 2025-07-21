import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { ProductCard } from "@/components/ui/product-card";
import { Product } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { HeroSection } from "@/components/ui/hero-section";
import { Loader2 } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { FashionProductCardFixed } from "@/components/ui/fashion-product-card-fixed";
import { LazySection } from "@/components/ui/lazy-section";
import { InfiniteScroll } from "@/components/ui/infinite-scroll";
import {
  useInfiniteProducts,
  useCategoryProducts,
} from "@/hooks/use-infinite-products";
import { usePerformanceMonitor } from "@/hooks/use-performance-monitor";
import {
  preloadProductImages,
  preloadCategoryImages,
} from "@/lib/image-preloader";
import { PerformanceMonitor } from "@/components/ui/performance-monitor";
import { useProductLoader } from "@/lib/product-loader";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { ArrowUp } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Memoize categories to prevent unnecessary re-renders
const allCategories = [
  "Electronics",
  "Fashion",
  "Home",
  "Appliances",
  "Mobiles",
  "Beauty",
  "Toys",
  "Grocery",
] as const;

interface ProductData {
  products: Product[];
  pagination: {
    currentPage: number;
    totalPages: number;
    total: number;
  };
}

interface SliderImage {
  url: string;
  alt: string;
  title?: string;
  subtitle?: string;
  link?: string;
}

interface DealOfTheDay {
  title: string;
  subtitle: string;
  image: string;
  originalPrice: string | number;
  discountPrice: string | number;
  discountPercentage: number;
  hours: number;
  minutes: number;
  seconds: number;
  productId?: number;
}

function useRecentlyViewedProducts() {
  const [recentlyViewed, setRecentlyViewed] = useState<any[]>([]);
  useEffect(() => {
    async function fetchRecentlyViewed() {
      const ids = JSON.parse(localStorage.getItem("recently_viewed_products") || "[]");
      if (!Array.isArray(ids) || ids.length === 0) {
        setRecentlyViewed([]);
        return;
      }
      const res = await fetch(`/api/products?ids=${ids.join(",")}`);
      if (!res.ok) return setRecentlyViewed([]);
      const data = await res.json();
      // Keep the order as in ids
      const ordered = ids.map((id: number) => (data.products || []).find((p: any) => p.id === id)).filter(Boolean);
      setRecentlyViewed(ordered);
    }
    fetchRecentlyViewed();
  }, []);
  return recentlyViewed;
}

function useBrowsingHistoryProducts() {
  const [browsingHistory, setBrowsingHistory] = useState<any[]>([]);
  useEffect(() => {
    async function fetchBrowsingHistory() {
      const ids = JSON.parse(localStorage.getItem("browsing_history_products") || "[]");
      if (!Array.isArray(ids) || ids.length === 0) {
        setBrowsingHistory([]);
        return;
      }
      const res = await fetch(`/api/products?ids=${ids.join(",")}`);
      if (!res.ok) return setBrowsingHistory([]);
      const data = await res.json();
      // Keep the order as in ids
      const ordered = ids.map((id: number) => (data.products || []).find((p: any) => p.id === id)).filter(Boolean);
      setBrowsingHistory(ordered);
    }
    fetchBrowsingHistory();
  }, []);
  return browsingHistory;
}

function RecentlyViewedSection() {
  const [recentlyViewed, setRecentlyViewed] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    async function fetchRecentlyViewed() {
      setLoading(true);
      try {
        const ids = JSON.parse(localStorage.getItem('recently_viewed_products') || '[]');
        if (!Array.isArray(ids) || ids.length === 0) {
          setRecentlyViewed([]);
          setLoading(false);
          return;
        }
        // Only fetch the latest 5
        const latestIds = ids.slice(0, 5);
        const productPromises = latestIds.map(id => 
          fetch(`/api/products/${id}`).then(res => res.ok ? res.json() : null)
        );
        const allProducts = (await Promise.all(productPromises)).filter(Boolean);
        // Keep the order as in localStorage
        const ordered = latestIds
          .map((id) => allProducts.find((p: any) => p.id === id))
          .filter((p) => p !== undefined && p !== null);
        setRecentlyViewed(ordered);
      } catch (e) {
        setRecentlyViewed([]);
      } finally {
        setLoading(false);
      }
    }
    fetchRecentlyViewed();
  }, []);
  return (
    <div className="container mx-auto py-6 px-4">
      <h2 className="text-2xl font-medium mb-4">Recently Viewed</h2>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-center flex-col">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3"></div>
          <h3 className="text-sm font-medium">Loading recently viewed products...</h3>
        </div>
      ) : recentlyViewed.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {recentlyViewed.map((product: any) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8 text-center flex-col">
          <h3 className="text-sm font-medium">No recently viewed products</h3>
          <p className="text-xs text-muted-foreground mt-1">Products you view will appear here</p>
          <Button variant="link" size="sm" className="mt-2" asChild>
            <Link href="/">Browse Products</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function BrowsingHistorySection() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    async function fetchHistory() {
      setLoading(true);
      try {
        // Assume you store search product IDs in localStorage under 'browsing_history_products'
        const ids = JSON.parse(localStorage.getItem('browsing_history_products') || '[]');
        if (!Array.isArray(ids) || ids.length === 0) {
          setHistory([]);
          setLoading(false);
          return;
        }
        // Only fetch the latest 5
        const latestIds = ids.slice(0, 5);
        const productPromises = latestIds.map(id => 
          fetch(`/api/products/${id}`).then(res => res.ok ? res.json() : null)
        );
        const allProducts = (await Promise.all(productPromises)).filter(Boolean);
        // Keep the order as in localStorage
        const ordered = latestIds
          .map((id) => allProducts.find((p: any) => p.id === id))
          .filter((p) => p !== undefined && p !== null);
        setHistory(ordered);
      } catch (e) {
        setHistory([]);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, []);
  return (
    <div className="container mx-auto py-6 px-4">
      <h2 className="text-2xl font-medium mb-4">Browsing History</h2>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-center flex-col">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3"></div>
          <h3 className="text-sm font-medium">Loading browsing history...</h3>
        </div>
      ) : history.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {history.map((product: any) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8 text-center flex-col">
          <h3 className="text-sm font-medium">No browsing history</h3>
          <p className="text-xs text-muted-foreground mt-1">Products you search for will appear here</p>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const [location] = useLocation();
  const [category, setCategory] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 36;

  // Performance monitoring
  const { startTimer, endTimer, recordProductsLoaded } = usePerformanceMonitor({
    enableLogging: process.env.NODE_ENV === "development",
  });

  // Product loader for faster loading
  const { preloadProductPages } = useProductLoader();

  // Memoize URL params parsing
  const searchParams = useMemo(() => {
    return new URLSearchParams(location.split("?")[1]);
  }, [location]);

  useEffect(() => {
    const categoryParam = searchParams.get("category");
    setCategory(categoryParam);
  }, [searchParams]);

  useEffect(() => {
    const pageParam = searchParams.get("page");
    if (pageParam) {
      setCurrentPage(parseInt(pageParam));
    } else {
      setCurrentPage(1);
    }
  }, [searchParams]);

  // Optimized hero products fetching with longer cache
  const { data: heroProducts, isLoading: isLoadingHero } = useQuery<
    SliderImage[]
  >({
    queryKey: ["/api/featured-hero-products"],
    queryFn: async () => {
      startTimer("api:hero-products");
      try {
        const res = await fetch(
          "/api/featured-hero-products?approved=true&status=approved"
        );
        if (!res.ok) throw new Error("Failed to fetch hero products");
        const data = await res.json();
        endTimer("api:hero-products", { count: data.length });
        return data;
      } catch (error) {
        endTimer("api:hero-products", { error });
        throw error;
      }
    },
    staleTime: 15 * 60 * 1000, // 15 minutes cache
    refetchOnWindowFocus: false,
  });

  // Optimized deal of the day fetching
  const { data: dealOfTheDay, isLoading: isLoadingDeal } =
    useQuery<DealOfTheDay>({
      queryKey: ["/api/deal-of-the-day"],
      queryFn: async () => {
        startTimer("api:deal-of-the-day");
        try {
          const res = await fetch("/api/deal-of-the-day");
          if (!res.ok) throw new Error("Failed to fetch deal of the day");
          const data = await res.json();
          endTimer("api:deal-of-the-day", { success: true });
          return data;
        } catch (error) {
          endTimer("api:deal-of-the-day", { error });
          throw error;
        }
      },
      staleTime: 5 * 60 * 1000, // 5 minutes cache
      refetchOnWindowFocus: false,
    });

  // Use infinite scroll for main products
  const {
    products: infiniteProducts,
    pagination: infinitePagination,
    hasMore,
    isLoading: isLoadingInfinite,
    isFetchingNextPage,
    loadMore,
  } = useInfiniteProducts({
    category: category || undefined,
    pageSize: 36,
    enabled: !category, // Only use infinite scroll for main page
  });

  // Use traditional pagination for category-specific products
  const { data: categoryData, isLoading: isLoadingCategory } =
    useCategoryProducts(category || "", itemsPerPage);

  // Extract products and pagination from the appropriate data source
  const { products, pagination } = useMemo(() => {
    if (category) {
      return {
        products: categoryData?.products || [],
        pagination: categoryData?.pagination || {
          currentPage: 1,
          totalPages: 1,
          total: 0,
        },
      };
    } else {
      return {
        products: infiniteProducts,
        pagination: infinitePagination,
      };
    }
  }, [category, categoryData, infiniteProducts, infinitePagination]);

  const isLoading = category ? isLoadingCategory : isLoadingInfinite;

  // Get featured products (first 5 products for priority loading)
  const featuredProducts = useMemo(() => {
    // Only show products with a real deal/discount (mrp > price)
    return products.filter((p) => p.mrp && p.mrp > p.price).slice(0, 5);
  }, [products]);

  // Preload critical images when products change
  useEffect(() => {
    if (featuredProducts.length > 0) {
      preloadProductImages(featuredProducts, 5);
    }
    if (products.length > 0) {
      preloadProductImages(products, products.length);
    }
  }, [featuredProducts, products]);

  // Preload category images
  useEffect(() => {
    if (category) {
      preloadCategoryImages(category);
    }
  }, [category]);

  // Preload next pages of products for faster infinite scroll
  useEffect(() => {
    if (
      !category &&
      infinitePagination &&
      infinitePagination.currentPage < infinitePagination.totalPages
    ) {
      // Preload next 2 pages in background
      preloadProductPages(
        "/api/products",
        infinitePagination.currentPage,
        infinitePagination.totalPages,
        {
          preloadPages: 2,
          concurrency: 3,
        }
      );
    }
  }, [category, infinitePagination, preloadProductPages]);

  // Record products loaded for performance monitoring
  useEffect(() => {
    if (products.length > 0) {
      recordProductsLoaded(products.length);
    }
  }, [products, recordProductsLoaded]);

  const getProductsByCategory = useMemo(() => {
    return (categoryName: string) => {
      return products
        .filter(
          (p: Product) =>
            p.category?.toLowerCase() === categoryName.toLowerCase()
        )
        .slice(0, 6);
    };
  }, [products]);

  const categorizedProducts = useMemo(() => {
    return allCategories
      .map((cat) => ({
        name: cat,
        title: `Top ${cat}`,
        products: getProductsByCategory(cat),
      }))
      .filter((catGroup) => catGroup.products.length > 0);
  }, [getProductsByCategory]);

  // Memoize loading components
  const ProductsLoading = useMemo(
    () => () => (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <Skeleton className="h-40 w-32 mb-3" />
            <Skeleton className="h-4 w-28 mb-2" />
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    ),
    []
  );

  const CategoryProductsLoading = useMemo(
    () => () => (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <Skeleton className="h-32 w-28 mb-2" />
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    ),
    []
  );

  // Show scroll-to-top button only when scrolled down
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 200);
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const recentlyViewed = useRecentlyViewedProducts();
  const browsingHistory = useBrowsingHistoryProducts();

  return (
    <>
      <Helmet>
        <title>
          LeleKart - India’s Leading Online Shopping Site for Electronics,
          Fashion, Home & More
        </title>
        <meta
          name="description"
          content="Shop online for electronics, fashion, home appliances, mobiles, beauty, toys, grocery and more at LeleKart. Best deals, fast delivery, and secure payments. Shop for affordable products at LeleKart. Buy online organic and herbal products. Shop now and save more."
        />
        <meta
          name="keywords"
          content="online shopping, electronics, fashion, mobiles, home appliances, beauty, toys, grocery, India, LeleKart, affordable products, organic products, herbal products, shop now, save more"
        />
      </Helmet>
      {/* Hero Section - Load immediately */}
      {isLoadingHero ? (
        <div className="h-64 bg-gradient-to-r from-blue-500 to-indigo-700 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-white animate-spin" />
        </div>
      ) : heroProducts && heroProducts.length > 0 ? (
        <HeroSection sliderImages={heroProducts} dealOfTheDay={dealOfTheDay} />
      ) : (
        <div className="h-64 bg-gradient-to-r from-blue-500 to-indigo-700 flex flex-col items-center justify-center text-white">
          <div className="mb-4">No banners found in Banner Management</div>
          <p className="text-sm opacity-80">
            Add banners in Admin Panel → Banner Management
          </p>
        </div>
      )}

      {/* Featured Deals - Priority loading for first 5 products */}
      <LazySection
        fallback={<ProductsLoading />}
        threshold={0.2}
        rootMargin="100px"
      >
        <div className="container mx-auto px-4 py-6">
          <h2 className="text-2xl font-medium mb-4">Featured Deals</h2>
          <div className="bg-cream p-4 rounded shadow-sm">
            {isLoading ? (
              <ProductsLoading />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {featuredProducts.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    featured={true}
                    priority={index < 3} // Priority loading for first 3 products
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </LazySection>

      {/* Browsing History Section */}
      <BrowsingHistorySection />
      {/* Recently Viewed Section */}
      <RecentlyViewedSection />

      {/* Category Blocks - Amazon style */}
      {!category && (
        <div className="container mx-auto px-2 py-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {allCategories.map((categoryName) => {
            const products = getProductsByCategory(categoryName).slice(0, 4);
            if (products.length === 0) return null;
            return (
              <div key={categoryName} className="bg-white rounded-2xl shadow-lg p-4 flex flex-col h-full border border-cream hover:shadow-2xl transition-all">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold text-gray-800">{categoryName}</h2>
                  <Link href={`/category/${categoryName.toLowerCase()}`} className="text-primary hover:underline font-medium text-sm">View All</Link>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {products.map((product, idx) => (
                    <ProductCard key={product.id} product={product} priority={idx < 2} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All Products Section - Lazy load with infinite scroll for main page */}
      {!category && (
        <LazySection
          fallback={<CategoryProductsLoading />}
          threshold={0.1}
          rootMargin="200px"
        >
          <div className="container mx-auto px-4 py-6">
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="all">All Products</TabsTrigger>
                <TabsTrigger value="new">New Arrivals</TabsTrigger>
                <TabsTrigger value="popular">Popular</TabsTrigger>
              </TabsList>

              <TabsContent
                value="all"
                className="bg-cream p-4 rounded shadow-sm"
              >
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-medium">All Products</h2>
                  <Link
                    href="/products"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    View All <span aria-hidden="true">→</span>
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                  {infiniteProducts.map((product, index) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      priority={index < 6}
                    />
                  ))}
                </div>

                {hasMore && (
                  <div className="mt-6 flex justify-center">
                    <Button
                      onClick={loadMore}
                      disabled={isFetchingNextPage}
                      className="flex items-center gap-2"
                    >
                      {isFetchingNextPage ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          View More
                          <ChevronDown className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {!hasMore && infiniteProducts.length > 0 && (
                  <div className="text-sm text-gray-500 text-center mt-4">
                    Showing {infiniteProducts.length} of{" "}
                    {infinitePagination.total} products
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="new"
                className="bg-cream p-4 rounded shadow-sm"
              >
                <div className="text-center py-8">
                  <p>New arrivals coming soon!</p>
                </div>
              </TabsContent>

              <TabsContent
                value="popular"
                className="bg-cream p-4 rounded shadow-sm"
              >
                <div className="text-center py-8">
                  <p>Popular products feature coming soon!</p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </LazySection>
      )}

      {/* Category-specific products with traditional pagination */}
      {category && products.length > 0 && (
        <div className="container mx-auto px-4 py-6">
          <h2 className="text-2xl font-medium mb-4 capitalize">
            {category} Products
          </h2>
          <div className="bg-cream p-4 rounded shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
              {products.map((product, index) =>
                category?.toLowerCase() === "fashion" ? (
                  <FashionProductCardFixed
                    key={product.id}
                    product={product}
                    priority={index < 6} // Priority loading for first 6 fashion products
                  />
                ) : (
                  <ProductCard
                    key={product.id}
                    product={product}
                    priority={index < 6} // Priority loading for first 6 products
                  />
                )
              )}
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="mt-6 flex justify-center">
                <Pagination
                  currentPage={pagination.currentPage}
                  totalPages={pagination.totalPages}
                  onPageChange={(page) => {
                    const params = new URLSearchParams(
                      location.split("?")[1] || ""
                    );
                    params.set("page", page.toString());
                    const newUrl = `/?category=${category}&${params.toString()}`;
                    window.location.href = newUrl;
                    window.scrollTo(0, 0);
                  }}
                />
              </div>
            )}

            <div className="text-sm text-gray-500 text-center mt-2">
              Showing {(pagination.currentPage - 1) * itemsPerPage + 1} to{" "}
              {Math.min(
                pagination.currentPage * itemsPerPage,
                pagination.total
              )}{" "}
              of {pagination.total} products
            </div>
          </div>
        </div>
      )}

      {/* No products found message */}
      {category && products.length === 0 && !isLoading && (
        <div className="container mx-auto px-4 py-6 text-center">
          <div className="bg-white p-8 rounded shadow-sm">
            <h2 className="text-2xl font-medium mb-2">No Products Found</h2>
            <p className="text-gray-600 mb-4">
              We couldn't find any products in the "{category}" category.
            </p>
            <Link href="/" className="text-primary hover:underline">
              View All Products
            </Link>
          </div>
        </div>
      )}

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-8 right-8 z-50 bg-primary text-white rounded-full shadow-2xl p-2 hover:bg-primary/90 transition-colors flex items-center justify-center border-4 border-white"
          style={{ boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.37)" }}
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-6 w-6" />
        </button>
      )}
    </>
  );
}

// Separate component for category sections to enable lazy loading
function CategorySection({
  category,
  index,
}: {
  category: string;
  index: number;
}) {
  const { data: categoryData, isLoading } = useCategoryProducts(category, 6);

  const products = categoryData?.products || [];

  if (products.length === 0) return null;

  return (
    <div className="container mx-auto px-4 py-4">
      <div className="bg-cream p-4 rounded shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-medium">Top {category}</h2>
          <Link
            href={`/category/${category.toLowerCase()}`}
            className="text-primary hover:underline"
          >
            View All
          </Link>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex flex-col items-center">
                <Skeleton className="h-32 w-28 mb-2" />
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {products.map((product, productIndex) =>
              category === "Fashion" ? (
                <FashionProductCardFixed
                  key={product.id}
                  product={product}
                  className="h-full"
                  priority={productIndex < 3} // Priority loading for first 3 fashion products
                />
              ) : (
                <ProductCard
                  key={product.id}
                  product={product}
                  priority={productIndex < 3} // Priority loading for first 3 products
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
