import React from "react";
import { Product, User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { CartContext } from "@/context/cart-context";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { apiRequest } from "@/lib/queryClient";
import { WishlistButton } from "./wishlist-button";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";

// Base64 encoded fashion images
const FASHION_IMAGES = [
  // Dress
  "data:image/jpeg;base64,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",
  // Ethnic wear
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjIpLCBxdWFsaXR5ID0gOTAK/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAZABkAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A+ZRxSd6KK9M6gpOlFFAFeX71MoopIDe0MYFdBRRXkYz+Ie/lP8Ij9KU9KKK4jvEooopiCiiigAooopAf/9k=",
  // Jacket
  "data:image/jpeg;base64,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",
  // Kurta
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjIpLCBxdWFsaXR5ID0gOTAK/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAZABkAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A+ZRxSd6KK9M6gpOlFFAFeX71MoopIDe0MYFdBRRXkYz+Ie/lP8Ij9KU9KKK4jvEooopiCiiigAooopAf/9k=",
  // Fashion shorts
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjIpLCBxdWFsaXR5ID0gOTAK/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAZABkAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A+Y9p9KCuKUHikzXpnKNIx2oA9qRmxTc+lIB+0nvUZXnrTGkx0NRmXPemIlIx0NNzUZkpN9MQ8nNJuqMtTS1AgooooEf/2Q==",
];

// Directly use Product from schema - it already has imageUrl defined
interface FashionProductCardFixedProps {
  product: Product;
  className?: string;
  priority?: boolean; // For above-the-fold images
}

export function FashionProductCardFixed({
  product,
  className,
  priority = false,
}: FashionProductCardFixedProps) {
  const cartContext = useContext(CartContext);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Get user data to check if logged in
  const { data: user } = useQuery<User | null>({
    queryKey: ["/api/user"],
    retry: false,
    staleTime: 60000,
  });

  // Get the product image, prioritizing the database image
  const getImageSrc = () => {
    // According to schema.ts, the correct field is imageUrl (even though database uses image_url)
    if (product.imageUrl && !product.imageUrl.includes("placeholder")) {
      return product.imageUrl;
    }

    // Access raw product for any non-standard fields that might be present in the data
    const rawProduct = product as any;

    // Try snake_case version that might be present in API responses
    if (
      rawProduct.image_url &&
      typeof rawProduct.image_url === "string" &&
      !rawProduct.image_url.includes("placeholder")
    ) {
      return rawProduct.image_url;
    }

    // If images array is available, try to use the first image
    if (product.images && typeof product.images === "string") {
      try {
        // Parse JSON string if needed
        const parsedImages = JSON.parse(product.images);
        if (
          Array.isArray(parsedImages) &&
          parsedImages.length > 0 &&
          typeof parsedImages[0] === "string"
        ) {
          return parsedImages[0];
        }
      } catch (e) {
        // If parsing fails, continue to fallback
        console.error("Failed to parse images JSON:", e);
      }
    }

    // Fallback to base64 images for consistent display
    const imageIndex = product.id % FASHION_IMAGES.length;
    return FASHION_IMAGES[imageIndex];
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

  return (
    <div className="relative bg-cream border border-gray-200 rounded-xl shadow-md hover:shadow-lg transition-shadow duration-200">
      {/* Add Wishlist button on top right of card */}
      <WishlistButton productId={product.id} variant="card" />

      <Link href={`/product/${product.id}`} className="block">
        <Card
          className={cn(
            "bg-cream h-full flex flex-col items-center p-4 transition-transform duration-200 hover:cursor-pointer hover:shadow-lg hover:-translate-y-1 border-none",
            className
          )}
        >
          <CardContent className="p-0 w-full flex flex-col items-center h-full">
            <div className="w-full flex-shrink-0 h-40 flex items-center justify-center mb-3 bg-white/40 rounded-lg overflow-hidden border border-gray-100">
              <img
                src={getImageSrc()}
                alt={product.name}
                className="max-w-full max-h-full object-cover rounded-sm"
              />
            </div>

            <div className="flex flex-col flex-grow w-full">
              <h3 className="font-medium text-center text-sm line-clamp-2 h-10">
                {product.name}
              </h3>
              <div className="text-green-600 font-medium mt-1 text-center">
                {formatPrice(product.price)}
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-primary hover:bg-primary/10"
              onClick={handleAddToCart}
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              Add to Cart
            </Button>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
