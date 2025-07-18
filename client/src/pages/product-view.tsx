import { useEffect, useState, useContext, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Product, User } from "@shared/schema";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Minus, Plus, ShoppingCart, Star, Zap } from "lucide-react";
import { ProductCard } from "@/components/ui/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { CartContext } from "@/context/cart-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ProductImageGallery } from "@/components/ui/product-image-gallery";
import { VariantSelector } from "@/components/product/variant-selector";
import { ProductVariant } from "@/components/product/multi-variant-table";
import { RichTextContent } from "@/components/ui/rich-text-content";

/**
 * This is a standalone product view page that doesn't use React Router parameters
 * It gets the product ID directly from the URL
 */
export default function ProductViewPage() {
  // Keep a stable reference to the component
  const componentMounted = useRef(true);

  // Get the product ID directly from the URL path
  const pathParts = window.location.pathname.split("/");
  const productIdStr = pathParts[pathParts.length - 1];
  const productId = parseInt(productIdStr);

  // Basic validation
  if (isNaN(productId)) {
    // Redirect to home if invalid product ID
    setTimeout(() => {
      window.location.href = "/";
    }, 200);
    return (
      <div className="p-10 text-center">Invalid product ID. Redirecting...</div>
    );
  }

  const [quantity, setQuantity] = useState(1);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Try to use context first if available
  const cartContext = useContext(CartContext);

  // Get user data to check if logged in
  const { data: user } = useQuery<User | null>({
    queryKey: ["/api/user"],
    retry: false,
    staleTime: 60000,
  });

  // Store the selected variant
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    null
  );
  // Track whether all required variant selections have been made
  const [isValidSelection, setIsValidSelection] = useState<boolean>(true);

  // Fetch product details with variants
  const { data: product, isLoading: isProductLoading } = useQuery<
    Product & { variants?: ProductVariant[] }
  >({
    queryKey: ["/api/products", productId],
    queryFn: async () => {
      if (!productId) throw new Error("Product ID is required");

      try {
        // Include the variants parameter to get variant data with the product
        const res = await fetch(`/api/products/${productId}?variants=true`);
        if (!res.ok) {
          throw new Error("Failed to fetch product details");
        }
        const data = await res.json();
        return data;
      } catch (error) {
        throw error;
      }
    },
    enabled: !!productId && !isNaN(productId),
    staleTime: 60000, // Keep data fresh for 1 minute
    refetchOnWindowFocus: false, // Don't refetch when window regains focus
  });

  // Fetch related products
  const { data: relatedProducts, isLoading: isRelatedLoading } = useQuery<
    Product[]
  >({
    queryKey: ["/api/products", { category: product?.category }],
    enabled: !!product?.category,
  });

  // Format price in Indian Rupees
  const formatPrice = (price: number) => {
    return `₹${price.toLocaleString("en-IN")}`;
  };

  // Create mutations for cart operations
  const addToCartMutation = useMutation({
    mutationFn: async (data: {
      productId: number;
      quantity: number;
      variantId?: number;
    }) => {
      return apiRequest("POST", "/api/cart", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      toast({
        title: "Added to cart",
        description: `${product?.name} has been added to your cart`,
        variant: "default",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add to cart",
        description:
          error.message || "There was an error adding the product to your cart",
        variant: "destructive",
      });
    },
  });

  // Handle add to cart action
  const handleAddToCart = async () => {
    if (!product) return;

    // If user is not logged in, redirect to auth
    if (!user) {
      toast({
        title: "Please log in",
        description: "You need to be logged in to add items to cart",
        variant: "default",
      });
      window.location.href = "/auth";
      return;
    }

    // Only buyers can add to cart
    const userRole = user?.role as string;
    if (userRole && userRole !== "buyer") {
      toast({
        title: "Action Not Allowed",
        description:
          "Only buyers can add items to cart. Please switch to a buyer account.",
        variant: "destructive",
      });
      return;
    }

    // Check if the product has variants but none are selected
    if (product.variants && product.variants.length > 0 && !isValidSelection) {
      toast({
        title: "Selection Required",
        description: "Please select all required options before adding to cart",
        variant: "destructive",
      });
      return;
    }

    try {
      // If a variant is selected, add that variant's product ID to cart
      if (selectedVariant && selectedVariant.id) {
        // Try to use context if available (now passing the selected variant)
        if (cartContext) {
          cartContext.addToCart(product, quantity, selectedVariant);
        } else {
          // Fallback to direct API call with variant id
          await addToCartMutation.mutateAsync({
            productId: product.id,
            variantId: selectedVariant.id,
            quantity: quantity,
          });
        }
      } else {
        // Add the main product to cart
        if (cartContext) {
          cartContext.addToCart(product, quantity);
        } else {
          // Fallback to direct API call
          await addToCartMutation.mutateAsync({
            productId: product.id,
            quantity: quantity,
          });
        }
      }

      toast({
        title: "Added to cart",
        description: `${product.name} ${
          selectedVariant
            ? `(${selectedVariant.color} ${selectedVariant.size})`
            : ""
        } has been added to your cart`,
        variant: "default",
      });
    } catch (error) {
      // Silent error handling - the mutation will show a toast error
    }
  };

  // Handle buy now action
  const handleBuyNow = async () => {
    if (!product) return;

    // If user is not logged in, redirect to auth
    if (!user) {
      toast({
        title: "Please log in",
        description: "You need to be logged in to purchase items",
        variant: "default",
      });
      window.location.href = "/auth";
      return;
    }

    // Only buyers can buy
    const userRole = user?.role as string;
    if (userRole && userRole !== "buyer") {
      toast({
        title: "Action Not Allowed",
        description:
          "Only buyers can purchase items. Please switch to a buyer account.",
        variant: "destructive",
      });
      return;
    }

    // Check if the product has variants but none are selected
    if (product.variants && product.variants.length > 0 && !isValidSelection) {
      toast({
        title: "Selection Required",
        description:
          "Please select all required options before proceeding to checkout",
        variant: "destructive",
      });
      return;
    }

    try {
      // If a variant is selected, add the product with the variant information
      if (selectedVariant && selectedVariant.id) {
        // Always make sure we're passing the correct product ID, not the variant ID
        const productToUse = { ...product }; // Clone to avoid reference issues

        // Try to use context if available
        if (cartContext) {
          cartContext.buyNow(productToUse, quantity, selectedVariant);
        } else {
          // Fallback to direct API approach with variant id
          await addToCartMutation.mutateAsync({
            productId: productToUse.id, // Always use the product ID here
            variantId: selectedVariant.id,
            quantity: quantity,
          });

          // Redirect to checkout
          window.location.href = "/checkout";
        }
      } else {
        // Try to use context if available
        if (cartContext) {
          cartContext.buyNow(product, quantity);
        } else {
          // Fallback to direct API approach
          await addToCartMutation.mutateAsync({
            productId: product.id,
            quantity: quantity,
          });

          // Redirect to checkout
          window.location.href = "/checkout";
        }
      }
    } catch (error) {
      // Silent error handling - the mutation will show a toast error
    }
  };

  return (
    <>
      <div className="container mx-auto px-4 py-6">
        {isProductLoading ? (
          <div className="bg-white p-6 rounded shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="flex justify-center">
                <Skeleton className="h-80 w-80" />
              </div>
              <div className="space-y-4">
                <Skeleton className="h-10 w-3/4" />
                <Skeleton className="h-6 w-1/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-20 w-full" />
                <div className="flex space-x-4">
                  <Skeleton className="h-10 w-32" />
                  <Skeleton className="h-10 w-32" />
                </div>
              </div>
            </div>
          </div>
        ) : product ? (
          <div className="bg-offwhite p-6 rounded shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Product Image Gallery */}
              <div className="flex justify-center items-start">
                <ProductImageGallery
                  imageUrl={
                    selectedVariant?.images
                      ? JSON.parse(selectedVariant.images as string)[0] ||
                        product.imageUrl
                      : product.imageUrl
                  }
                  additionalImages={
                    selectedVariant?.images && selectedVariant.images !== "[]"
                      ? selectedVariant.images
                      : product.images
                  }
                  productName={product.name}
                  category={product.category}
                />
              </div>

              {/* Product Details */}
              <div>
                <h1 className="text-2xl font-semibold text-gray-800">
                  {product.name}
                </h1>
                <div className="flex items-center mt-2">
                  <div className="flex items-center bg-green-600 text-white px-2 py-0.5 rounded text-sm">
                    <span>4.3</span>
                    <Star className="h-3 w-3 ml-1 fill-current" />
                  </div>
                  <span className="text-gray-500 text-sm ml-2">
                    (1,248 Ratings & 235 Reviews)
                  </span>
                </div>

                <div className="mt-4">
                  {selectedVariant ? (
                    // Show variant price with GST details if available
                    selectedVariant.gstDetails ? (
                      <>
                        <span className="text-3xl font-semibold text-gray-900">
                          {formatPrice(selectedVariant.gstDetails.priceWithGst)}
                        </span>
                        <span className="text-sm text-gray-500 line-through ml-2">
                          ₹
                          {(
                            selectedVariant.gstDetails.priceWithGst * 1.2
                          ).toLocaleString("en-IN")}
                        </span>
                        <span className="text-sm text-green-600 ml-2">
                          20% off
                        </span>
                        <div className="text-sm text-gray-500 mt-1">
                          Incl. {selectedVariant.gstDetails.gstRate}% GST
                        </div>
                      </>
                    ) : (
                      // Show variant price without GST details
                      <>
                        <span className="text-3xl font-semibold text-gray-900">
                          {formatPrice(selectedVariant.price)}
                        </span>
                        <span className="text-sm text-gray-500 line-through ml-2">
                          ₹
                          {(selectedVariant.price * 1.2).toLocaleString(
                            "en-IN"
                          )}
                        </span>
                        <span className="text-sm text-green-600 ml-2">
                          20% off
                        </span>
                      </>
                    )
                  ) : // Show product price with GST details if available
                  product.gstDetails ? (
                    <>
                      <span className="text-3xl font-semibold text-gray-900">
                        {formatPrice(product.gstDetails.priceWithGst)}
                      </span>
                      <span className="text-sm text-gray-500 line-through ml-2">
                        ₹
                        {(product.gstDetails.priceWithGst * 1.2).toLocaleString(
                          "en-IN"
                        )}
                      </span>
                      <span className="text-sm text-green-600 ml-2">
                        20% off
                      </span>
                      <div className="text-sm text-gray-500 mt-1">
                        Incl. {product.gstDetails.gstRate}% GST
                      </div>
                    </>
                  ) : (
                    // Show product price without GST details
                    <>
                      <span className="text-3xl font-semibold text-gray-900">
                        {formatPrice(product.price)}
                      </span>
                      <span className="text-sm text-gray-500 line-through ml-2">
                        ₹{(product.price * 1.2).toLocaleString("en-IN")}
                      </span>
                      <span className="text-sm text-green-600 ml-2">
                        20% off
                      </span>
                    </>
                  )}
                </div>

                {/* Variant Selector */}
                {product.variants && product.variants.length > 0 && (
                  <div className="mt-6">
                    <VariantSelector
                      variants={product.variants}
                      onVariantChange={setSelectedVariant}
                      onValidSelectionChange={setIsValidSelection}
                    />
                  </div>
                )}

                <div className="mt-6">
                  <h3 className="font-medium text-gray-900">Description:</h3>
                  <RichTextContent
                    content={product.description}
                    className="mt-1 text-gray-600"
                  />
                </div>

                <div className="mt-6">
                  <h3 className="font-medium text-gray-900">Availability:</h3>
                  <p className="mt-1 text-gray-600">
                    {selectedVariant
                      ? selectedVariant.stock > 0
                        ? selectedVariant.stock <= 5
                          ? "Only a few left in stock!"
                          : "In stock"
                        : "Out of stock"
                      : product.stock > 0
                        ? product.stock <= 5
                          ? "Only a few left in stock!"
                          : "In stock"
                        : "Out of stock"}
                  </p>
                </div>

                <Separator className="my-6" />

                <div className="flex items-center">
                  <span className="mr-3 font-medium">Quantity:</span>
                  <div className="flex items-center">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-l"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      disabled={quantity <= 1}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-12 h-8 bg-white flex items-center justify-center text-sm border-t border-b">
                      {quantity}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-r"
                      onClick={() =>
                        setQuantity(
                          Math.min(
                            selectedVariant
                              ? selectedVariant.stock
                              : product.stock,
                            quantity + 1
                          )
                        )
                      }
                      disabled={
                        quantity >=
                        (selectedVariant
                          ? selectedVariant.stock
                          : product.stock)
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-4">
                  <Button
                    className="bg-orange-500 hover:bg-orange-600 text-white px-8"
                    onClick={handleAddToCart}
                    disabled={!isValidSelection}
                  >
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    {!isValidSelection &&
                    product.variants &&
                    product.variants.length > 0
                      ? "SELECT OPTIONS"
                      : "ADD TO CART"}
                  </Button>
                  <Button
                    className="bg-primary hover:bg-primary/90 text-white px-8"
                    onClick={handleBuyNow}
                    disabled={!isValidSelection}
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    {!isValidSelection &&
                    product.variants &&
                    product.variants.length > 0
                      ? "SELECT OPTIONS"
                      : "BUY NOW"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white p-6 rounded shadow-sm text-center">
            <h2 className="text-xl font-semibold text-gray-800">
              Product not found
            </h2>
            <p className="text-gray-600 mt-2">
              The product you're looking for doesn't exist or has been removed.
            </p>
          </div>
        )}

        {/* Related Products */}
        {!isRelatedLoading && relatedProducts && relatedProducts.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-medium mb-4">Similar Products</h2>
            <div className="bg-offwhite p-4 rounded shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                {relatedProducts
                  .filter((p) => p.id !== product?.id)
                  .slice(0, 6)
                  .map((relatedProduct) => (
                    <div
                      key={relatedProduct.id}
                      className="cursor-pointer"
                      onClick={() => {
                        // Force full page reload to avoid router issues
                        window.location.href = `/product-view/${relatedProduct.id}`;
                      }}
                    >
                      <ProductCard product={relatedProduct} />
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
