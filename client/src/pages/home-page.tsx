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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6 overflow-hidden">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6 overflow-hidden">
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

  // Preload all category menu images instantly
  useEffect(() => {
    allCategories.forEach((cat) => {
      preloadCategoryImages(cat);
    });
  }, []);

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

  // Add helper functions at the top of HomePage (after useMemo, before return)
  const under199Products = useMemo(() => products.filter(p => Number(p.price) <= 199).slice(0, 4), [products]);
  const under399Products = useMemo(() => products.filter(p => Number(p.price) > 199 && Number(p.price) <= 399).slice(0, 4), [products]);
  const under599Products = useMemo(() => products.filter(p => Number(p.price) > 399 && Number(p.price) <= 599).slice(0, 4), [products]);
  const off20Products = useMemo(() => products.filter(p => p.mrp && p.price && Math.round(((p.mrp - p.price) / p.mrp) * 100) >= 20 && Math.round(((p.mrp - p.price) / p.mrp) * 100) < 40).slice(0, 5), [products]);
  const off40Products = useMemo(() => products.filter(p => p.mrp && p.price && Math.round(((p.mrp - p.price) / p.mrp) * 100) >= 40 && Math.round(((p.mrp - p.price) / p.mrp) * 100) < 50).slice(0, 5), [products]);
  const off50Products = useMemo(() => products.filter(p => p.mrp && p.price && Math.round(((p.mrp - p.price) / p.mrp) * 100) >= 50 && Math.round(((p.mrp - p.price) / p.mrp) * 100) < 60).slice(0, 5), [products]);

  // Helper for trending: try to pick one each from saree, men shirt, men jeans, top
  function pickTrendingFashionProducts(fashionProducts) {
    const wanted = [
      { label: 'saree', match: p => (p.subcategory || '').toLowerCase().includes('saree') || (p.name || '').toLowerCase().includes('saree') },
      { label: 'men shirt', match: p => (p.subcategory || '').toLowerCase().includes('shirt') && (p.name || '').toLowerCase().includes('men') },
      { label: 'men jeans', match: p => (p.subcategory || '').toLowerCase().includes('jeans') && (p.name || '').toLowerCase().includes('men') },
      { label: 'top', match: p => (p.subcategory || '').toLowerCase().includes('top') || (p.name || '').toLowerCase().includes('top') },
    ];
    const usedIds = new Set();
    const result = [];
    for (const w of wanted) {
      const found = fashionProducts.find(p => !usedIds.has(p.id) && w.match(p));
      if (found) {
        result.push(found);
        usedIds.add(found.id);
      }
    }
    // Fill with other fashion products with lowest discount
    for (const p of fashionProducts) {
      if (result.length === 4) break;
      if (!usedIds.has(p.id)) {
        result.push(p);
        usedIds.add(p.id);
      }
    }
    return result.slice(0, 4);
  }

  // Helper for trending: pick 4 Fashion products with name containing saree, top, shirt/tshirt, jeans/denim
  function pickTrendingFashionProductsStrict(fashionProducts) {
    // 1. shirt or tshirt
    // 2. top
    // 3. saree
    // 4. jeans
    const wanted = [
      { label: 'shirt/tshirt', match: p => /shirt|tshirt/i.test(p.name || '') },
      { label: 'top', match: p => /top/i.test(p.name || '') },
      { label: 'saree', match: p => /saree/i.test(p.name || '') },
      { label: 'jeans', match: p => /jeans/i.test(p.name || '') },
    ];
    const usedIds = new Set();
    const result = [];
    for (const w of wanted) {
      const found = fashionProducts.find(p => !usedIds.has(p.id) && w.match(p));
      if (found) {
        result.push(found);
        usedIds.add(found.id);
      }
    }
    // Fill with other fashion products with lowest discount
    for (const p of fashionProducts) {
      if (result.length === 4) break;
      if (!usedIds.has(p.id)) {
        result.push(p);
        usedIds.add(p.id);
      }
    }
    return result.slice(0, 4);
  }

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
          LeleKart - India's Leading Online Shopping Site for Electronics,
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

      {/* Under 199, 399, 599 Sections - Above Featured Deals */}
      <div className="container mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[{title: 'Under ₹199', prods: under199Products, link: '/products?maxPrice=199'}, {title: 'Under ₹399', prods: under399Products, link: '/products?minPrice=200&maxPrice=399'}, {title: 'Under ₹599', prods: under599Products, link: '/products?minPrice=400&maxPrice=599'}].map(({title, prods, link}) => (
          prods.length > 0 ? (
            <div key={title} className="bg-gradient-to-br from-[#f5e7d4] via-[#fff8f1] to-[#ffe7b8] rounded-2xl shadow-lg p-4 flex flex-col h-full border border-cream hover:shadow-2xl transition-all min-w-[240px] min-h-[320px] max-w-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-bold text-gray-800">{title}</h2>
                <Link href={link} className="text-primary hover:underline font-medium text-sm">View All</Link>
              </div>
              <div className="grid grid-cols-2 grid-rows-2 gap-4 w-full h-full overflow-hidden">
                {prods.map((product, idx) => (
                  <ProductCard key={product.id} product={product} compact={true} showAddToCart={false} showWishlist={false} naked={true} idx={idx} />
                ))}
              </div>
            </div>
          ) : null
        ))}
      </div>
      {/* Best Seller, Featured Deal Sections - 4-product boxes */}
      <div className="container mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Best Seller */}
        {(() => {
          // Get all products from 20/40/50% off
          const bestSellerCandidates = [
            ...off20Products.map(p => ({...p, _group: 20})),
            ...off40Products.map(p => ({...p, _group: 40})),
            ...off50Products.map(p => ({...p, _group: 50})),
          ];
          // Sort by discount percentage descending
          bestSellerCandidates.sort((a, b) => {
            const aDisc = Math.round(((a.mrp - a.price) / a.mrp) * 100);
            const bDisc = Math.round(((b.mrp - b.price) / b.mrp) * 100);
            return bDisc - aDisc;
          });
          // Pick up to 2 from the group with the highest discount, then 1 from each of the other two
          const groups = {20: [], 40: [], 50: []};
          for (const p of bestSellerCandidates) {
            if (groups[p._group].length < 2 && Object.values(groups).flat().length < 2) {
              groups[p._group].push(p);
            }
          }
          // Fill with 1 from each of the other two groups
          for (const g of [20, 40, 50]) {
            if (groups[g].length === 0) {
              const prod = bestSellerCandidates.find(p => p._group === g);
              if (prod) groups[g].push(prod);
            }
          }
          // Flatten and take 4
          const bestSellerProducts = Object.values(groups).flat().slice(0, 4);
          return bestSellerProducts.length === 4 ? (
            <div className="bg-gradient-to-br from-[#f5e7d4] via-[#fff8f1] to-[#ffe7b8] rounded-2xl shadow-lg p-4 flex flex-col h-full border border-cream hover:shadow-2xl transition-all min-w-[240px] min-h-[320px] max-w-full">
              <div className="flex items-center mb-3">
                <h2 className="text-xl font-bold text-gray-800">Best Seller</h2>
              </div>
              <div className="grid grid-cols-2 grid-rows-2 gap-4 w-full h-full overflow-hidden">
                {bestSellerProducts.map((product, idx) => (
                  <ProductCard key={product.id} product={product} compact={true} showAddToCart={false} showWishlist={false} naked={true} idx={idx} />
                ))}
              </div>
            </div>
          ) : null;
        })()}
        {/* Trending Products Section */}
        {(() => {
          // Get all Fashion products
          const fashionProducts = products.filter(p => (p.category || '').toLowerCase() === 'fashion');
          // Calculate discount percentage for each product
          const withDiscount = fashionProducts.map(p => {
            let discount = 0;
            if (p.mrp && p.price && p.mrp > 0) {
              discount = Math.round(((p.mrp - p.price) / p.mrp) * 100);
            }
            return { ...p, _discount: discount };
          });
          // Sort by lowest discount percentage
          withDiscount.sort((a, b) => a._discount - b._discount);
          // Pick trending: 1st shirt/t-shirt, 2nd saree, 3rd top, 4th jeans (all with lowest discount)
          const wanted = [
            { label: 'shirt/tshirt', match: p => /t\s*-?shirt|shirt/i.test(p.name || '') },
            { label: 'saree', match: p => /saree/i.test(p.name || '') },
            { label: 'top', match: p => /top/i.test(p.name || '') },
            { label: 'jeans', match: p => /jeans/i.test(p.name || '') },
          ];
          const usedIds = new Set();
          const trending = [];
          for (const w of wanted) {
            const found = withDiscount.find(p => !usedIds.has(p.id) && w.match(p));
            if (found) {
              trending.push(found);
              usedIds.add(found.id);
            }
          }
          // Fill with other fashion products with lowest discount if less than 4
          for (const p of withDiscount) {
            if (trending.length === 4) break;
            if (!usedIds.has(p.id)) {
              trending.push(p);
              usedIds.add(p.id);
            }
          }
          return trending.length === 4 ? (
            <div className="bg-gradient-to-br from-[#f5e7d4] via-[#fff8f1] to-[#ffe7b8] rounded-2xl shadow-lg p-4 flex flex-col h-full border border-cream hover:shadow-2xl transition-all min-w-[240px] min-h-[320px] max-w-full">
              <div className="flex items-center mb-3">
                <h2 className="text-xl font-bold text-gray-800">Trending Products</h2>
              </div>
              <div className="grid grid-cols-2 grid-rows-2 gap-4 w-full h-full overflow-hidden">
                {trending.map((product, idx) => (
                  <ProductCard key={product.id} product={product} compact={true} showAddToCart={false} showWishlist={false} naked={true} idx={idx} showDiscountBadge={true} />
                ))}
              </div>
            </div>
          ) : null;
        })()}
        {/* Featured Deal */}
        {(() => {
          // 4 products with highest MRP and real discount
          const featuredDealProducts = products.filter(p => p.mrp && p.mrp > p.price).sort((a, b) => b.mrp - a.mrp).slice(0, 4);
          return featuredDealProducts.length === 4 ? (
            <div className="bg-gradient-to-br from-[#f5e7d4] via-[#fff8f1] to-[#ffe7b8] rounded-2xl shadow-lg p-4 flex flex-col h-full border border-cream hover:shadow-2xl transition-all min-w-[240px] min-h-[320px] max-w-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-bold text-gray-800">Featured Deal</h2>
                <Link href="/products?sort=featured" className="text-primary hover:underline font-medium text-sm">View All</Link>
              </div>
              <div className="grid grid-cols-2 grid-rows-2 gap-4 w-full h-full overflow-hidden">
                {featuredDealProducts.map((product, idx) => (
                  <ProductCard key={product.id} product={product} compact={true} showAddToCart={false} showWishlist={false} naked={true} idx={idx} showDiscountBadge={true} />
                ))}
              </div>
            </div>
          ) : null;
        })()}
      </div>
      {/* 20/40/50% Off Sections - Below Featured Deals */}
      <div className="container mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[{title: '20% Off', prods: off20Products, link: '/products?discount=20'}, {title: '40% Off', prods: off40Products, link: '/products?discount=40'}, {title: '50% Off', prods: off50Products, link: '/products?discount=50'}].map(({title, prods, link}) => (
          prods.length > 0 ? (
            <div key={title} className="bg-gradient-to-br from-[#f5e7d4] via-[#fff8f1] to-[#ffe7b8] rounded-2xl shadow-lg p-4 flex flex-col h-full border border-cream hover:shadow-2xl transition-all min-w-[240px] min-h-[320px] max-w-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-bold text-gray-800">{title}</h2>
                <Link href={link} className="text-primary hover:underline font-medium text-sm">View All</Link>
              </div>
              <div className="grid grid-cols-2 grid-rows-2 gap-4 w-full h-full overflow-hidden">
                {prods.slice(0, 4).map((product, idx) => (
                   <ProductCard key={product.id} product={product} compact={true} showAddToCart={false} showWishlist={false} naked={true} idx={idx} showDiscountBadge={true} />
                 ))}
              </div>
            </div>
          ) : null
        ))}
      </div>
      {/* Recently Viewed Section - after discount sections */}
      <RecentlyViewedSection />
      {/* Remove FiftyPercentOffSection (Up to 50% Off) */}

      {/* Category Blocks - Amazon style */}
      {!category && (
        <div className="container mx-auto px-2 py-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {allCategories.map((categoryName) => {
            const products = getProductsByCategory(categoryName).slice(0, 4);
            if (products.length === 0) return null;
            return (
              <div key={categoryName} className="bg-gradient-to-br from-[#f5e7d4] via-[#fff8f1] to-[#ffe7b8] rounded-2xl shadow-lg p-4 flex flex-col h-full border border-cream hover:shadow-2xl transition-all min-w-[340px] min-h-[420px] max-w-full">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold text-gray-800">{categoryName}</h2>
                  <Link href={`/category/${categoryName.toLowerCase()}`} className="text-primary hover:underline font-medium text-sm">View All</Link>
                </div>
                <div className="grid grid-cols-2 grid-rows-2 gap-6 w-full h-full overflow-hidden">
                  {products.map((product, idx) => (
                    <ProductCard key={product.id} product={product} priority={idx < 2} compact={true} showAddToCart={false} showWishlist={false} naked={true} idx={idx} />
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

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6 overflow-hidden">
                  {infiniteProducts.map((product, index) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      priority={index < 6}
                      showAddToCart={true}
                      showWishlist={true}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6 overflow-hidden">
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

      {/* Browsing History Section - always at the end */}
      <BrowsingHistorySection />

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
                  compact={true}
                  showAddToCart={false}
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
