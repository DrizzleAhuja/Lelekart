import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout/layout";
import { ProductCard } from "@/components/ui/product-card";
import { FashionProductCardFixed } from "@/components/ui/fashion-product-card-fixed";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Filter, SlidersHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Product, Subcategory } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Pagination } from "@/components/ui/pagination";
import { Helmet } from "react-helmet-async";

export default function CategoryPage() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  // Extract the category from the URL path
  const urlParts = location.split("/");
  let categoryName;

  // Check if we're on a category page with clean URL or with query params
  if (location.startsWith("/category/")) {
    categoryName = decodeURIComponent(
      urlParts[urlParts.length - 1].split("?")[0]
    );
  } else {
    categoryName = decodeURIComponent(urlParts[urlParts.length - 1]);
  }

  // State for sorting, filtering, and pagination
  const [sortOrder, setSortOrder] = useState<string>("featured");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100000]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(10); // Number of products per page
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(
    null
  );

  // Find category ID from categorySlug
  const { data: categories } = useQuery<any[]>({
    queryKey: ["/api/categories"],
  });

  // First try to match by slug, then fallback to name for backward compatibility
  const category =
    categories?.find((cat: any) => cat.slug === categoryName) ||
    categories?.find((cat: any) => cat.name === categoryName);
  const categoryId = category?.id;
  const displayName = category?.name || categoryName;

  // Fetch subcategories for the current category
  const { data: subcategories, isLoading: isLoadingSubcategories } = useQuery({
    queryKey: ["/api/subcategories", categoryId],
    queryFn: async () => {
      if (!categoryId) return [];
      const response = await fetch(
        `/api/subcategories?categoryId=${categoryId}`
      );
      if (!response.ok) {
        console.error("Failed to fetch subcategories");
        return [];
      }
      return response.json();
    },
    enabled: !!categoryId,
  });

  // Function to get the latest URL search params
  const getLatestSearchParams = () => {
    // Get directly from window.location.search to ensure latest params
    return new URLSearchParams(window.location.search);
  };

  const searchParams = getLatestSearchParams();
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");
  const subcategoryParam = searchParams.get("subcategory");

  // Set current page, items per page, and subcategory from URL params if available
  useEffect(() => {
    // Get the latest URL parameters
    const latestParams = getLatestSearchParams();
    const currentSubcategoryParam = latestParams.get("subcategory");
    const currentPageParam = latestParams.get("page");
    const currentLimitParam = latestParams.get("limit");

    // Set page from URL parameter
    if (currentPageParam) {
      const page = parseInt(currentPageParam);
      if (!isNaN(page) && page > 0) {
        setCurrentPage(page);
      }
    } else {
      setCurrentPage(1); // Reset to page 1 when category changes
    }

    // Set items per page from URL parameter
    if (currentLimitParam) {
      const limit = parseInt(currentLimitParam);
      if (!isNaN(limit) && [10, 100, 500].includes(limit)) {
        setItemsPerPage(limit);
      }
    }

    // Set selected subcategory from URL parameter
    if (currentSubcategoryParam) {
      setSelectedSubcategory(currentSubcategoryParam);
    } else {
      setSelectedSubcategory(null); // Reset when not specified
    }
  }, [location, categoryName]);

  // Fetch products for the specific category with pagination
  const { data, isLoading, error } = useQuery({
    queryKey: [
      "/api/products",
      displayName,
      currentPage,
      itemsPerPage,
      selectedSubcategory,
    ],
    queryFn: async () => {
      if (!displayName)
        return { products: [], pagination: { total: 0, totalPages: 0 } };

      let url = `/api/products?category=${encodeURIComponent(
        displayName
      )}&page=${currentPage}&limit=${itemsPerPage}&status=approved&approved=true`;

      // Include subcategory in API call if selected
      if (selectedSubcategory) {
        console.log("Adding subcategory to API request:", selectedSubcategory);
        url += `&subcategory=${encodeURIComponent(selectedSubcategory)}`;
      }

      console.log("Requesting products with URL:", url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch products");
      }
      return response.json();
    },
  });

  // Extract products and pagination from response
  const products = data?.products || [];
  const pagination = data?.pagination || {
    currentPage: 1,
    totalPages: 1,
    total: 0,
  };

  // Extract available distinct values from the products to act as "brands"
  useEffect(() => {
    if (products && products.length > 0) {
      // Use seller names as "brands" since our schema doesn't have a separate brand field
      const distinctNames: string[] = [];
      products.forEach((product: Product) => {
        // Extract brand-like identifier from product name
        const nameParts = product.name.split(" ");
        if (nameParts.length > 0) {
          const potentialBrand = nameParts[0]; // Use first word of product name as brand
          if (potentialBrand && !distinctNames.includes(potentialBrand)) {
            distinctNames.push(potentialBrand);
          }
        }
      });
      setAvailableBrands(distinctNames);
    }
  }, [products]);

  // Filter and sort products
  const filteredProducts = [...products]
    .filter((product: Product) => {
      // Filter by price range
      const price = Number(product.price);
      const inPriceRange = price >= priceRange[0] && price <= priceRange[1];

      // Filter by selected brands (if any)
      // Using the first word of product name as a substitute for brand
      const nameParts = product.name.split(" ");
      const firstWord = nameParts.length > 0 ? nameParts[0] : "";
      const matchesBrand =
        selectedBrands.length === 0 ||
        (firstWord && selectedBrands.includes(firstWord));

      // Filter by selected subcategory (if any)
      // We need to use subcategoryId along with the subcategories array to match by name
      // When filtered via API, we don't need additional filtering here
      const matchesSubcategory = true; // Already filtered by the API with subcategory parameter

      return inPriceRange && matchesBrand && matchesSubcategory;
    })
    .sort((a: Product, b: Product) => {
      // Sort by the selected order
      switch (sortOrder) {
        case "price-low-high":
          return Number(a.price) - Number(b.price);
        case "price-high-low":
          return Number(b.price) - Number(a.price);
        case "newest":
          return (
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
          );
        default: // "featured" or any other default
          return 0; // Keep original order
      }
    });

  // Handle brand selection changes
  const handleBrandChange = (brand: string) => {
    setSelectedBrands((prev) => {
      if (prev.includes(brand)) {
        return prev.filter((b) => b !== brand);
      } else {
        return [...prev, brand];
      }
    });
  };

  // Handle clearing all filters
  const handleClearFilters = () => {
    setSelectedBrands([]);
    setPriceRange([0, 100000]);
    setSortOrder("featured");
    setSelectedSubcategory(null);

    toast({
      title: "Filters cleared",
      description: "All filters have been reset to default values.",
    });
  };

  // Handle price range changes
  const handlePriceRangeChange = (value: number[]) => {
    setPriceRange([value[0], value[1]]);
  };

  // Build page title and meta description based on category
  const metaTitle = displayName
    ? `${displayName} - Buy ${displayName} Online at Best Prices | LeleKart`
    : "Shop by Category | LeleKart";
  const metaDescription = displayName
    ? `Shop for ${displayName} online at LeleKart. Discover a wide range of products, best deals, and fast delivery. Shop for affordable products at LeleKart. Buy online organic and herbal products. Shop now and save more.`
    : "Shop by category on LeleKart. Discover a wide range of products, best deals, and fast delivery. Shop for affordable products at LeleKart. Buy online organic and herbal products. Shop now and save more.";
  const metaKeywords = displayName
    ? `${displayName}, online shopping, LeleKart, buy ${displayName} online, deals, affordable products, organic products, herbal products, shop now, save more`
    : "online shopping, LeleKart, buy online, deals, affordable products, organic products, herbal products, shop now, save more";

  if (error) {
    return (
      <>
        <Helmet>
          <title>{metaTitle}</title>
          <meta name="description" content={metaDescription} />
          <meta name="keywords" content={metaKeywords} />
        </Helmet>
        <Layout>
          <div className="container mx-auto py-8">
            <div className="text-center py-12">
              <h2 className="text-2xl font-bold text-red-600">
                Error Loading Products
              </h2>
              <p className="mt-2 text-gray-600">
                We couldn't load products for this category. Please try again
                later.
              </p>
              <Button className="mt-4" onClick={() => setLocation("/")}>
                Return to Home
              </Button>
            </div>
          </div>
        </Layout>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta name="keywords" content={metaKeywords} />
      </Helmet>
      {/* Header section with category title and filters */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">
            {displayName}
            {selectedSubcategory ? ` - ${selectedSubcategory}` : ""}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Page size selector */}
          <div className="flex items-center">
            <span className="text-sm mr-2">Show:</span>
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(value) => {
                setItemsPerPage(parseInt(value));
                setCurrentPage(1); // Reset to first page when changing page size

                // Update URL to include page size
                const params = new URLSearchParams(
                  location.split("?")[1] || ""
                );
                params.set("limit", value);
                params.set("page", "1");

                // Build new URL with category and params
                const newUrl = `/category/${categoryName}?${params.toString()}`;
                setLocation(newUrl);
              }}
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue placeholder="10" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="500">500</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="featured">Featured</SelectItem>
              <SelectItem value="price-low-high">Price: Low to High</SelectItem>
              <SelectItem value="price-high-low">Price: High to Low</SelectItem>
              <SelectItem value="newest">Newest First</SelectItem>
            </SelectContent>
          </Select>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[300px] sm:w-[400px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Filter Products</SheetTitle>
                <SheetDescription>
                  Narrow down products based on your preferences.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Price Range Filter */}
                <div>
                  <h3 className="font-medium mb-3">Price Range</h3>
                  <div className="space-y-4">
                    <Slider
                      min={0}
                      max={100000}
                      step={1000}
                      value={[priceRange[0], priceRange[1]]}
                      onValueChange={handlePriceRangeChange}
                      className="mt-6"
                    />
                    <div className="flex items-center justify-between">
                      <span>₹{priceRange[0].toLocaleString()}</span>
                      <span>₹{priceRange[1].toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Brand Filter */}
                {availableBrands.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-3">Brand</h3>
                    <div className="space-y-2">
                      {availableBrands.map((brand) => (
                        <div
                          key={brand}
                          className="flex items-center space-x-2"
                        >
                          <Checkbox
                            id={`brand-${brand}`}
                            checked={selectedBrands.includes(brand)}
                            onCheckedChange={() => handleBrandChange(brand)}
                          />
                          <Label
                            htmlFor={`brand-${brand}`}
                            className="text-sm cursor-pointer"
                          >
                            {brand}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4">
                  <Button
                    onClick={handleClearFilters}
                    variant="outline"
                    className="w-full"
                  >
                    Clear All Filters
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Subcategories navigation */}
      {isLoadingSubcategories ? (
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {Array(5)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 rounded-full" />
              ))}
          </div>
        </div>
      ) : (
        subcategories &&
        subcategories.length > 0 && (
          <div className="mb-6">
            <div className="flex flex-wrap gap-2">
              <Button
                key="all"
                variant={selectedSubcategory === null ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setSelectedSubcategory(null);

                  // Update URL to remove subcategory parameter
                  const params = new URLSearchParams(
                    location.split("?")[1] || ""
                  );
                  params.delete("subcategory");

                  // Preserve other parameters like page and limit
                  const newUrl = `/category/${categoryName}${
                    params.toString() ? `?${params.toString()}` : ""
                  }`;
                  setLocation(newUrl);
                }}
                className="rounded-full"
              >
                All
              </Button>

              {subcategories.map((subcategory: Subcategory) => (
                <Button
                  key={subcategory.id}
                  variant={
                    selectedSubcategory === subcategory.slug
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  onClick={() => {
                    setSelectedSubcategory(subcategory.slug);

                    // Update URL to include subcategory parameter
                    const params = new URLSearchParams(
                      location.split("?")[1] || ""
                    );
                    params.set("subcategory", subcategory.slug);

                    // Preserve other parameters and reset to page 1
                    params.set("page", "1");

                    // Build new URL with category and params
                    const newUrl = `/category/${categoryName}?${params.toString()}`;
                    setLocation(newUrl);
                  }}
                  className="rounded-full"
                >
                  {subcategory.name}
                </Button>
              ))}
            </div>
          </div>
        )
      )}

      {/* Products grid - Mood board style */}
      <div className="bg-[#f8f5f0] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-lg font-semibold text-gray-700">Show filter</span>
        </div>
      {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array(8)
            .fill(0)
            .map((_, i) => (
                <div key={i} className="aspect-square bg-white rounded-xl shadow-md flex items-center justify-center">
                  <Skeleton className="h-24 w-24 rounded" />
              </div>
            ))}
        </div>
      ) : filteredProducts.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredProducts.map((product: Product) => (
              <div
                  key={product.id}
                className="aspect-square bg-white rounded-xl shadow-md flex flex-col items-center justify-center p-4 hover:shadow-xl transition cursor-pointer"
                onClick={() => setLocation(`/products/${product.id}`)}
              >
                <div className="w-full h-32 flex items-center justify-center mb-2">
                  <img
                    src={product.imageUrl || "/images/placeholder.svg"}
                    alt={product.name}
                    className="max-w-full max-h-full object-contain rounded"
                  />
                </div>
                <div className="w-full text-center mt-2">
                  <span className="block text-base font-medium text-gray-900 truncate">{product.name}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <h2 className="text-2xl font-semibold">No Products Found</h2>
            <p className="mt-2 text-gray-600">
              {selectedSubcategory ? (
                <>No products found in this subcategory.</>
              ) : (
                <>No products found in this category.</>
              )}
            </p>
          </div>
            )}
          </div>

          {/* Pagination component */}
          {pagination && pagination.totalPages > 1 && (
            <Pagination
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              onPageChange={(page) => {
                // Get current params and preserve them (like limit)
                const params = new URLSearchParams(
                  location.split("?")[1] || ""
                );

                // Update the page parameter
                params.set("page", page.toString());

                // Make sure limit parameter is preserved
                if (!params.has("limit") && itemsPerPage !== 10) {
                  params.set("limit", itemsPerPage.toString());
                }

                // Build new URL with category and params
                const newUrl = `/category/${categoryName}?${params.toString()}`;
                console.log(`Navigating to: ${newUrl}`);

                // Update the page
                setCurrentPage(page);

                // Update location
                setLocation(newUrl);

                // Scroll to top when page changes
                window.scrollTo(0, 0);
              }}
            />
          )}

          {/* Results count */}
          <div className="text-sm text-gray-500 text-center mt-2">
            Showing {(pagination.currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(pagination.currentPage * itemsPerPage, pagination.total)}{" "}
            of {pagination.total} products
          </div>
    </>
  );
}
