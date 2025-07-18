import { Product, User } from "@shared/schema";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { CartContext } from "@/context/cart-context";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext } from "react";
import { apiRequest } from "@/lib/queryClient";
import { WishlistButton } from "./wishlist-button";

// Define an extended Product interface to include image_url
interface ExtendedProduct extends Product {
  image?: string;
  image_url?: string;
}

interface FashionProductCardProps {
  product: ExtendedProduct;
}

export function FashionProductCard({ product }: FashionProductCardProps) {
  const cartContext = useContext(CartContext);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  // Get user data to check if logged in
  const { data: user } = useQuery<User | null>({
    queryKey: ['/api/user'],
    retry: false,
    staleTime: 60000,
  });

  // Format price in Indian Rupees
  const formatPrice = (price: number) => {
    return `₹${price.toLocaleString('en-IN')}`;
  };
  
  // Strip HTML tags from string
  const stripHtmlTags = (html: string) => {
    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  };
  
  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Remove login check, allow add to cart for all
    try {
      if (cartContext) {
        cartContext.addToCart(product);
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

  // Use a consistent fashion image for all fashion products
  return (
    <div className="relative bg-[#f5e7d4]">
      {/* Add Wishlist button on top right of card */}
      <WishlistButton productId={product.id} variant="card" />
      <Card 
        className="bg-white/80 h-full flex flex-col items-center p-5 transition-transform duration-200 hover:cursor-pointer rounded-2xl shadow-xl border border-black/10"
        onClick={() => {
          try {
            console.log(`Navigating to product details page: /product/${product.id}`);
            setLocation(`/product/${product.id}`);
          } catch (e) {
            console.error('Navigation error:', e);
          }
        }}
      >
        <CardContent className="p-0 w-full flex flex-col items-center h-full">
          <div className="w-full flex-shrink-0 h-44 flex items-center justify-center mb-4 bg-white rounded-xl overflow-hidden border border-yellow-200">
            <img
              src="/images/categories/fashion.svg"
              alt={product.name}
              className="max-w-full max-h-full object-contain rounded-sm"
            />
          </div>
          <div className="flex flex-col flex-grow w-full">
            <h3 className="font-semibold text-center text-base line-clamp-2 h-12 text-black group-hover:text-primary transition-colors">
              {product.name}
            </h3>
            <div className="text-green-700 font-bold mt-1 text-center flex items-center justify-center gap-2 text-lg">
              {formatPrice(product.price)}
            </div>
            <div className="text-xs text-gray-500 mt-1 text-center line-clamp-1">{stripHtmlTags(product.description).slice(0, 30)}...</div>
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
        </CardContent>
      </Card>
    </div>
  );
}