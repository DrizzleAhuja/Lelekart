import { Product, User } from "@shared/schema";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { CartContext } from "@/context/cart-context"; // Import context directly
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, memo } from "react";
import { apiRequest } from "@/lib/queryClient";
import { WishlistButton } from "./wishlist-button";
import { ProductImage } from "./product-image";
import { fbq } from "@/lib/metaPixel";

// Define an extended Product interface to include image_url and GST details
interface ExtendedProduct extends Omit<Product, "imageUrl"> {
  image?: string;
  image_url?: string;
  imageUrl?: string | null;
  hasVariants?: boolean;
  variants?: any[];
  gstDetails?: {
    gstRate: number;
    basePrice: number;
    gstAmount: number;
    priceWithGst: number;
  };
}

interface ProductCardProps {
  product: ExtendedProduct;
  featured?: boolean;
  priority?: boolean; // For above-the-fold images
  showAddToCart?: boolean; // New prop to control Add to Cart button
  compact?: boolean; // New prop for square/compact style
  showWishlist?: boolean; // New prop to control Wishlist button
  showDiscountBadge?: boolean; // New prop
}

export const ProductCard = memo(function ProductCard({
  product,
  featured = false,
  priority = false,
  showAddToCart = true, // Default to true
  compact = false, // Default to false
  showWishlist = true, // Default to true
  showDiscountBadge = false,
}: ProductCardProps) {
  const cartContext = useContext(CartContext); // Use context directly with optional chaining
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Get user data to check if logged in
  const { data: user } = useQuery<User | null>({
    queryKey: ["/api/user"],
    retry: false,
    staleTime: 60000,
  });

  // Format price in Indian Rupees
  const formatPrice = (price: number) => {
    return `₹${price.toLocaleString("en-IN")}`;
  };

  // Strip HTML tags from string
  const stripHtmlTags = (html: string) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast({
        title: "Please log in",
        description: "You need to be logged in to add items to cart",
        variant: "default",
      });
      setLocation("/auth");
      return;
    }
    if (user.role === "admin" || user.role === "seller") {
      toast({
        title: "Action Not Allowed",
        description:
          "Only buyers can add items to cart. Please switch to a buyer account.",
        variant: "destructive",
      });
      return;
    }
    try {
      if (cartContext) {
        cartContext.addToCart(product as Product);
      }
      // Show toast is handled in context
    } catch (error) {
      toast({
        title: "Failed to add to cart",
        description: "There was an error adding the product to your cart",
        variant: "destructive",
      });
    }
  };

  // Determine if this should be a priority image (featured products or first few products)
  const shouldPrioritize = priority || featured;

  // Calculate discount percentage for any product with MRP > price
  const discountPercent =
    product.mrp && product.price && product.mrp > product.price
      ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
      : 0;
  const hasDiscount = discountPercent > 0;

  // Use the same dimensions and styling for all product cards regardless of featured status
  return (
    <div className="relative box-border m-0 min-w-0 w-full h-full">
      {/* Discount badge - only show if showDiscountBadge is true */}
      {showDiscountBadge && hasDiscount && (
        <div className="absolute top-3 left-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-black text-xs font-bold px-3 py-1 rounded-full z-10 shadow-lg border border-white">
          {discountPercent}% OFF
        </div>
      )}
      {/* Add Wishlist button on top right of card */}
      {showWishlist && <WishlistButton productId={product.id} variant="card" />}

      <Card
        className={
          compact
            ? "bg-white w-full flex flex-col items-stretch p-0 transition-transform duration-200 hover:shadow-2xl hover:-translate-y-1.5 border border-gray-200 rounded-lg shadow group cursor-pointer box-border min-w-0"
            : "bg-white h-full w-full flex flex-col items-stretch p-0 transition-transform duration-200 hover:shadow-2xl hover:-translate-y-1.5 border border-gray-200 rounded-lg shadow group cursor-pointer box-border min-w-0"
        }
        onClick={() => {
            // Manually add to recently viewed products as backup
            try {
              const key = "recently_viewed_products";
              const existing = localStorage.getItem(key);
              let ids: number[] = [];
              if (existing) {
                try {
                  ids = JSON.parse(existing);
                } catch {
                  ids = [];
                }
              }
              // Remove if already present
              ids = ids.filter((id: number) => id !== product.id);
              // Add to start
              ids.unshift(product.id);
              // Keep only latest 20
              if (ids.length > 20) ids = ids.slice(0, 20);
              localStorage.setItem(key, JSON.stringify(ids));
              console.log(
                "[ProductCard] Added product to recently viewed:",
                product.id,
                ids
              );
            } catch (e) {
              console.error(
                "[ProductCard] Error adding to recently viewed:",
                e
              );
            }
            // --- Meta Pixel product click tracking ---
            try {
              fbq("track", "ViewContent", {
                content_ids: [product.id],
                content_name: product.name,
                content_type: "product",
                value: product.price,
                currency: "INR",
              });
              console.log(
                "[MetaPixel] ViewContent fired for product",
                product.id,
                product.name
              );
            } catch (e) {
              console.error("[MetaPixel] Error firing ViewContent pixel", e);
            }
            // Navigate to product details page
            setLocation(`/products/${product.id}`);
          }}
      >
        <CardContent className={compact ? "p-0 w-full flex flex-col items-stretch" : "p-0 w-full flex flex-col items-stretch h-full"}>
          <div className={compact ? "w-full h-32 flex items-center justify-center bg-white rounded-t-lg overflow-hidden border-b border-gray-100 group-hover:border-orange-300 transition-all" : "w-full h-44 flex items-center justify-center bg-white rounded-t-lg overflow-hidden border-b border-gray-100 group-hover:border-orange-300 transition-all"}>
            <ProductImage
              product={product}
              className={compact ? "object-contain max-h-28 w-auto h-auto" : "object-contain max-h-40 w-auto h-auto"}
              priority={shouldPrioritize}
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
            />
          </div>

          <div className={compact ? "flex flex-col w-full px-2" : "flex flex-col flex-grow w-full px-3 py-2"}>
            <h3 className={compact ? "font-semibold text-left text-sm line-clamp-2 min-h-[32px] text-black group-hover:text-primary transition-colors" : "font-semibold text-left text-base line-clamp-2 min-h-[40px] text-black group-hover:text-primary transition-colors"}>
              {product.name}
            </h3>
            <div className={compact ? "text-green-700 font-bold text-left flex items-center gap-2 text-base" : "text-green-700 font-bold mt-1 text-left flex items-center gap-2 text-lg"}>
              {product.gstDetails && product.gstDetails.priceWithGst != null
                ? formatPrice(product.gstDetails.priceWithGst)
                : formatPrice(product.price)}
              {/* Show MRP strikethrough only for featured deals with real discounts */}
              {hasDiscount && typeof product.mrp === 'number' && (
                <span className="text-gray-400 text-sm line-through ml-2">
                  {formatPrice(product.mrp)}
                </span>
              )}
            </div>
            {/* Only show Add to Cart if not compact and showAddToCart is true */}
            {/* No extra div or spacing below price for compact */}
            {!compact && showAddToCart && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full text-primary font-bold rounded border border-orange-300 bg-gradient-to-r from-yellow-50 to-orange-50 hover:from-orange-100 hover:to-yellow-100 shadow-sm"
                onClick={e => { handleAddToCart(e); e.stopPropagation(); }}
              >
                <ShoppingCart className="h-5 w-5 mr-2" />
                Add to Cart
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
