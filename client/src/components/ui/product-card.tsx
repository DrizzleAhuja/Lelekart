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
}

export const ProductCard = memo(function ProductCard({
  product,
  featured = false,
  priority = false,
  showAddToCart = true, // Default to true
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

  // Calculate discount percentage only for featured deals with real discounts
  const hasDiscount = featured && product.mrp && product.mrp > product.price;
  const discountPercent =
    hasDiscount && product.mrp
      ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
      : 0;

  // Use the same dimensions and styling for all product cards regardless of featured status
  return (
    <div className="relative bg-[#f5e7d4]">
      {/* Discount badge - ONLY show for featured deals */}
      {hasDiscount && discountPercent > 0 && (
        <div className="absolute top-3 left-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-black text-xs font-bold px-3 py-1 rounded-full z-10 shadow-lg border border-white">
          {discountPercent}% OFF
        </div>
      )}
      {/* Add Wishlist button on top right of card */}
      <WishlistButton productId={product.id} variant="card" />

      {/* Use normalized path that starts with a slash to prevent double slashes */}
      <Card
        className="bg-white/80 h-full flex flex-col items-center p-5 transition-transform duration-200 hover:cursor-pointer border-none rounded-2xl shadow-xl border border-black/10"
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
        <CardContent className="p-0 w-full flex flex-col items-center h-full">
          <div className="w-full flex-shrink-0 h-44 flex items-center justify-center mb-4 bg-white rounded-xl overflow-hidden border border-yellow-200 group-hover:border-orange-300 transition-all">
            <ProductImage
              product={product}
              className="rounded-sm"
              priority={shouldPrioritize}
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
            />
          </div>

          <div className="flex flex-col flex-grow w-full">
            <h3 className="font-semibold text-center text-base line-clamp-2 h-12 text-black group-hover:text-primary transition-colors">
              {product.name}
            </h3>
            <div className="text-green-700 font-bold mt-1 text-center flex items-center justify-center gap-2 text-lg">
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
            <div className="text-xs text-gray-500 mt-2 text-center line-clamp-2 min-h-[32px]">
              {stripHtmlTags(product.description).slice(0, 50)}...
            </div>
            <Button
              variant="ghost"
              size="lg"
              className="mt-4 w-full text-black bg-gradient-to-r from-yellow-400 to-orange-500 font-extrabold rounded-full shadow-lg hover:from-orange-500 hover:to-yellow-400 transition-transform duration-150 active:scale-95 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2"
              onClick={e => { handleAddToCart(e); e.currentTarget.classList.add('animate-pulse'); setTimeout(() => e.currentTarget.classList.remove('animate-pulse'), 300); }}
            >
              <ShoppingCart className="h-5 w-5 mr-2" />
              Add to Cart
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
