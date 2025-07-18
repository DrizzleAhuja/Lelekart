import { useState, useContext, useRef, useEffect } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Product as BaseProduct, ProductVariant, User } from "@shared/schema";
import { VariantImageModal } from "@/components/ui/variant-image-modal";
import SimpleImageSlider from "@/components/product/simple-image-slider";

// Extend the Product type to include the variants property
type Product = BaseProduct & {
  variants?: ProductVariant[];
  sellerName?: string;
  sellerUsername?: string;
  warranty?: number;
  isVariant?: boolean; // Flag to indicate if this is a variant in the cart
  parentProductId?: number; // Parent product ID for variants in the cart
  gstDetails?: {
    rate?: string;
    hsnCode?: string;
    gstFormattedPrice?: string;
    gstAmount?: number;
    gstRate?: string;
    basePrice?: number;
    priceWithGst?: number;
  };
};

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Minus,
  Plus,
  ShoppingCart,
  Star,
  Zap,
  Heart,
  Share2,
  Package,
  Shield,
  TruckIcon,
  Award,
  BarChart3,
  ChevronDown,
  Maximize,
  RotateCw,
  AlertTriangle,
  Info,
  Check,
  ZoomIn,
} from "lucide-react";
import { ProductCard } from "@/components/ui/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { CartContext, CartProvider } from "@/context/cart-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatPrice } from "@/lib/utils";
import { WishlistButton } from "@/components/ui/wishlist-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProductReviews from "@/components/product/product-reviews";
import ProductRecommendationCarousel from "@/components/ui/product-recommendation-carousel";
// AI components removed
import { RichTextContent } from "@/components/ui/rich-text-content";
import { VariantSelector } from "@/components/product/variant-selector";
import ImageZoom from "react-image-zoom";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import React360View from "react-360-view";

// Custom enhanced image slider component with zoom and 360-degree view capabilities
function ProductImageSlider({
  images,
  name,
  selectedVariantImages = [],
  selectedVariant = null,
}: {
  images: string[];
  name: string;
  selectedVariantImages?: string[];
  selectedVariant?: any;
}) {
  // Simple state management
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"normal" | "zoom" | "360">("normal");

  // Track processed images
  const [processedImages, setProcessedImages] = useState<string[]>([]);

  // Track validated images
  const [validImages, setValidImages] = useState<string[]>([]);

  // Track active image index
  const [activeImage, setActiveImage] = useState(0);

  // Container ref for calculating zoom dimensions
  const containerRef = useRef<HTMLDivElement>(null);

  // Default placeholder image based on category
  const defaultImage = "../images/placeholder.svg";

  // Helper function to check problematic URLs
  const isProblematicUrl = (url: string) => {
    return (
      !url ||
      url.includes("placeholder.com") ||
      url.includes("via.placeholder") ||
      url === "null" ||
      url === "undefined" ||
      url === ""
    );
  };

  // Handle image loading error
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;
    target.onerror = null; // Prevent infinite loop
    target.src = defaultImage;
  };

  // Simple helper to parse JSON with fallback
  const parseJson = (jsonString: string | null | undefined) => {
    if (!jsonString) return null;
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      console.error("JSON parse error:", e);
      return null;
    }
  };

  // Simple helper to extract images from any format
  const extractImages = (source: unknown): string[] => {
    const images: string[] = [];

    // Invalid input
    if (!source) return images;

    // Handle string that looks like a JSON array
    if (typeof source === "string" && source.trim().startsWith("[")) {
      const parsed = parseJson(source);
      if (Array.isArray(parsed)) {
        (Array.isArray(parsed) ? parsed : []).forEach((url: string) => {
          if (typeof url === "string" && url.includes("http")) {
            images.push(url);
          }
        });
        return images;
      }
    }

    // Handle array
    if (Array.isArray(source)) {
      source.forEach((item: unknown) => {
        if (typeof item === "string") {
          // Single URL
          if (item.includes("http")) {
            images.push(item);
          }
        }
      });
      return images;
    }

    // Single URL string
    if (typeof source === "string" && source.includes("http")) {
      images.push(source);
    }

    return images;
  };

  // Function to get all valid images from a product
  const getProductImages = (
    productData: Product | undefined | null
  ): string[] => {
    if (!productData) return [];

    const images: string[] = [];

    // Add main image URL
    if (
      productData.imageUrl &&
      typeof productData.imageUrl === "string" &&
      productData.imageUrl.includes("http")
    ) {
      images.push(productData.imageUrl);
    }

    // Process images array
    if (productData.images) {
      // Handle JSON string
      if (typeof productData.images === "string") {
        const parsed = parseJson(productData.images);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: unknown) => {
            if (typeof url === "string" && url.includes("http")) {
              images.push(url);
            }
          });
        }
      }
      // Handle array
      else if (Array.isArray(productData.images)) {
        productData.images.forEach((img: unknown) => {
          if (typeof img === "string" && img.includes("http")) {
            images.push(img);
          }
        });
      }
    }

    // Filter out invalid URLs
    return images.filter(
      (url) =>
        url &&
        typeof url === "string" &&
        !url.includes("placeholder.com") &&
        !url.includes("via.placeholder") &&
        url !== "null" &&
        url !== "undefined" &&
        url.trim() !== ""
    );
  };

  // Function to get variant images
  const getVariantImages = (
    variant: ProductVariant | null | undefined
  ): string[] => {
    if (!variant) return [];

    // Check if variant has images property
    if (!variant.images) return [];

    // Try to parse JSON if it's a string
    if (typeof variant.images === "string") {
      const parsed = parseJson(variant.images);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (url: unknown) =>
            typeof url === "string" &&
            url.includes("http") &&
            !isProblematicUrl(url)
        );
      }
    }

    // Handle array
    if (Array.isArray(variant.images)) {
      return variant.images.filter(
        (url: unknown) =>
          typeof url === "string" &&
          url.includes("http") &&
          !isProblematicUrl(url)
      );
    }

    return [];
  };

  // Get the product data from the query with proper type safety
  const productData = product || undefined;

  // Initial product image loading
  useEffect(() => {
    if (!productData) return;

    try {
      // Set initial state
      setActiveIndex(0);
      setActiveImage(0);
      setViewMode("normal");

      // Get all product images
      const productImages = getProductImages(productData);

      // Set state with images or fallback
      if (productImages.length > 0) {
        setValidImages(productImages);
        setProcessedImages(productImages);
      } else {
        setValidImages([defaultImage]);
        setProcessedImages([defaultImage]);
      }
    } catch (error: any) {
      console.error("Error processing product images:", error);
      // Safe fallback
      setValidImages([defaultImage]);
      setProcessedImages([defaultImage]);
    }
  }, [productData, defaultImage]);

  // Update images when a variant is selected
  useEffect(() => {
    // Skip if product is not loaded yet
    if (!productData) return;

    try {
      // Get product images (base set of images)
      const productImages = getProductImages(productData);

      // If no variant is selected, just use product images
      if (!selectedVariant) {
        if (productImages.length > 0) {
          setValidImages(productImages);
          setProcessedImages(productImages);
        } else {
          setValidImages([defaultImage]);
          setProcessedImages([defaultImage]);
        }
        return;
      }

      // Get variant-specific images
      const variantImages = getVariantImages(selectedVariant);

      // Combine product images with variant images
      // (Always include product images even when a variant is selected)
      const allImages = [...productImages, ...variantImages];

      // Remove duplicates - use Array.from to solve the Set iteration issue
      const uniqueImages = Array.from(new Set(allImages));

      // Update state with unique set of images
      if (uniqueImages.length > 0) {
        setValidImages(uniqueImages);
        setProcessedImages(uniqueImages);
        // Reset to first image when changing variants
        setActiveIndex(0);
        setActiveImage(0);
      } else {
        setValidImages([defaultImage]);
        setProcessedImages([defaultImage]);
      }
    } catch (error: any) {
      console.error("Error handling variant images:", error);
      // Don't reset images on error, keep the current ones
    }
  }, [selectedVariant, productData, defaultImage]);

  // Monitor image slider updates (removed debug logging for performance)

  // Create a simulated 360° rotation effect using the available product images
  const get360Images = () => {
    // Use the validated images that have already been processed
    const images = validImages || [];
    if (images.length === 0) return [];

    // If we only have one image, use it as the base for the simulation
    if (images.length === 1) {
      return Array(36).fill(images[0]);
    }

    // Use all available product images and repeat them to create a circular effect
    // For example, if we have 4 images, we'll create a sequence like [0,1,2,3,2,1,0,1,2,3...] to simulate rotation
    const allImages = [...images];

    // Create a sequence that goes forward then backward through the images
    // This creates a more natural rotation effect with limited images
    const frames: string[] = [];

    // Generate 36 frames for a complete 360° view (each frame = 10 degrees)
    for (let i = 0; i < 36; i++) {
      // Determine which image to use for this frame
      // We cycle through the available images to create the illusion of rotation
      const index = i % (allImages.length * 2);

      // If we're in the first half of the cycle, go forward through images
      // If we're in the second half, go backward
      const imageIndex =
        index < allImages.length ? index : allImages.length * 2 - index - 1;

      frames.push(allImages[imageIndex]);
    }

    return frames;
  };

  // Get props for ImageZoom component
  const getZoomProps = () => {
    if (!containerRef.current) return {};

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight || 384; // Default height

    // Safely access validImages
    const images = validImages || [];
    const imageToShow =
      images.length > 0 && activeImage < images.length
        ? images[activeImage]
        : defaultImage;

    return {
      img: imageToShow,
      zoomPosition: "original",
      width: width,
      height: height,
      zoomWidth: width * 2,
      zoomStyle: "opacity: 1;background-color: white;",
      alt: name,
    };
  };

  return (
    <div className="space-y-4 product-image-slider">
      {/* Variant badge - show when a variant is selected */}
      {selectedVariant && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 mb-3 text-sm">
          <div className="flex items-center">
            <Check size={18} className="text-green-600 mr-2 flex-shrink-0" />
            <div>
              <span className="text-green-700 font-medium">
                {selectedVariant.color}{" "}
                {selectedVariant.size && `/ ${selectedVariant.size}`} variant
                selected
              </span>
            </div>
          </div>
        </div>
      )}

      {/* View mode toggle buttons */}
      <div className="flex gap-2 justify-end">
        <Button
          variant={viewMode === "normal" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setViewMode("normal");
          }}
          className="flex items-center gap-1"
        >
          <Maximize size={16} />
          <span>Normal</span>
        </Button>

        <Button
          variant={viewMode === "zoom" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setViewMode("zoom");
          }}
          className="flex items-center gap-1"
        >
          <ZoomIn size={16} />
          <span>Zoom</span>
        </Button>

        <Button
          variant={viewMode === "360" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setViewMode("360");
          }}
          className="flex items-center gap-1"
        >
          <RotateCw size={16} />
          <span>360° View</span>
        </Button>
      </div>

      <div className="flex">
        {/* Thumbnails on the left - always visible regardless of view mode */}
        <div className="flex flex-col gap-2 mr-4">
          {(() => {
            const images = validImages || [];

            if (Array.isArray(images) && images.length > 0) {
              return images.map((image: string, index: number) => (
                <div
                  key={index}
                  className={`w-16 h-16 border cursor-pointer hover:border-primary ${
                    index === activeImage ? "border-primary" : "border-gray-200"
                  }`}
                  onClick={() => {
                    setActiveImage(index);
                    if (viewMode !== "normal") setViewMode("normal");
                  }}
                >
                  <img
                    src={image}
                    alt={`${name} thumbnail ${index + 1}`}
                    className="w-full h-full object-contain"
                    onError={handleImageError}
                  />
                </div>
              ));
            } else {
              return (
                <div className="w-16 h-16 border border-gray-200 flex items-center justify-center">
                  <span className="text-xs text-gray-400">No images</span>
                </div>
              );
            }
          })()}
        </div>

        {/* Main image area with different view modes */}
        <div ref={containerRef} className="flex-1 sticky top-0">
          {viewMode === "normal" && (
            <div className="w-full h-96 border border-gray-100 flex items-center justify-center bg-white">
              {/* Use simple clickable image that expands to full screen on click */}
              <img
                src={(() => {
                  // Safely access image url
                  const images = validImages || [];

                  if (images.length > 0) {
                    // Make sure activeImage is in bounds
                    if (activeImage < images.length) {
                      return images[activeImage];
                    } else {
                      return images[0]; // Fallback to first image
                    }
                  }

                  return defaultImage; // Fallback to default image
                })()}
                alt={name}
                className="max-w-full max-h-full object-contain cursor-zoom-in main-image"
                onError={handleImageError}
                onClick={() => setViewMode("zoom")}
              />
              <div className="absolute bottom-2 right-2 bg-black bg-opacity-60 text-white p-1 rounded text-xs">
                Click to zoom
              </div>
            </div>
          )}

          {viewMode === "zoom" && (
            <div className="w-full h-96 border border-gray-100 bg-white">
              <div className="h-full relative">
                <Zoom>
                  <img
                    src={
                      validImages &&
                      validImages.length > 0 &&
                      activeImage < validImages.length
                        ? validImages[activeImage]
                        : validImages && validImages.length > 0
                          ? validImages[0]
                          : defaultImage
                    }
                    alt={name}
                    className="max-w-full max-h-full object-contain"
                    onError={handleImageError}
                    style={{ maxHeight: "384px", margin: "0 auto" }}
                  />
                </Zoom>
              </div>
              <div className="mt-2 text-center text-xs text-gray-500">
                Click on the image to zoom in and out
              </div>
            </div>
          )}

          {viewMode === "360" && (
            <div className="w-full h-96 border border-gray-100 bg-white overflow-hidden">
              {get360Images().length > 0 ? (
                <>
                  <div className="h-full flex items-center justify-center">
                    <div className="w-full h-full">
                      {/* Interactive 360° view implementation with user controls */}
                      <div
                        className="relative w-full h-full flex items-center justify-center"
                        onMouseMove={(e) => {
                          // Calculate rotation based on mouse position
                          const frames = get360Images();
                          if (frames.length === 0) return;

                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = e.clientX - rect.left; // x position within the element
                          const relativeX = x / rect.width;

                          // Map the x position to a frame index (0 to frames.length-1)
                          const frameIndex = Math.min(
                            frames.length - 1,
                            Math.max(0, Math.floor(relativeX * frames.length))
                          );

                          // Use already validated images
                          const imageFrames = validImages || [];

                          if (validImages.length > 0) {
                            // Ensure frameIndex is valid and within bounds
                            const safeIndex = Math.min(
                              Math.max(0, frameIndex % validImages.length),
                              validImages.length - 1
                            );
                            setActiveImage(safeIndex);
                          }
                        }}
                      >
                        <img
                          src={
                            validImages && validImages.length > 0
                              ? validImages[activeImage]
                              : defaultImage
                          }
                          alt={`${name} 360 view`}
                          className="max-w-full max-h-full object-contain"
                          onError={handleImageError}
                        />
                        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                          <div className="bg-black bg-opacity-60 text-white px-3 py-1 rounded-full text-xs flex items-center">
                            <RotateCw size={14} className="mr-1 animate-spin" />
                            <span>Move mouse left/right to rotate</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-center text-xs text-gray-500">
                    Interactive 360° view (move your mouse from left to right to
                    rotate)
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  360° view not available for this product
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add a helper text explaining the interactions */}
      <div className="text-sm text-gray-500 mt-2">
        <p className="font-medium">Interactive view options:</p>
        <ul className="list-disc pl-5 mt-1">
          <li>Normal: Click to enlarge the image</li>
          <li>Zoom: Click on the image to zoom in and out</li>
          <li>
            360° View: Move your mouse left and right to rotate the product
          </li>
        </ul>
      </div>
    </div>
  );
}

// Wrap the entire component with CartProvider
// Define the pincode response type
interface PincodeResponse {
  isDeliverable: boolean;
  message: string;
  pincode?: string;
  etd?: string | null;
  cod_available?: boolean;
  courier_companies?: any[];
  location?: {
    state: string;
    district: string;
  };
}

export default function ProductDetailsPage() {
  // Extract product ID from the URL using wouter's useRoute
  const [match, params] = useRoute("/product/:id");
  const productId = match ? parseInt(params.id) : null;

  const [quantity, setQuantity] = useState(1);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State for variant selection
  const [selectedVariant, setSelectedVariant] = useState<any>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedVariantImages, setSelectedVariantImages] = useState<string[]>(
    []
  );
  const [isValidSelection, setIsValidSelection] = useState<boolean>(true);

  // Variant image modal state
  const [variantImageModalOpen, setVariantImageModalOpen] = useState(false);
  const [modalImages, setModalImages] = useState<string[]>([]);
  const [modalVariantInfo, setModalVariantInfo] = useState<
    | {
        color?: string;
        size?: string;
        price?: number;
        mrp?: number;
        stock?: number;
      }
    | undefined
  >(undefined);

  // State for pincode check
  const [pincode, setPincode] = useState<string>("");
  const [isPincodeChecking, setIsPincodeChecking] = useState<boolean>(false);
  const [pincodeResponse, setPincodeResponse] =
    useState<PincodeResponse | null>(null);

  // Track slider update trigger for debugging purposes
  const [sliderUpdateCount, setSliderUpdateCount] = useState(0);

  // --- Recently Viewed Products Tracking ---
  useEffect(() => {
    // Ensure productId is a valid number
    if (typeof productId !== "number" || isNaN(productId) || productId <= 0) {
      console.log(
        "[ProductDetails] Invalid productId for recently viewed tracking:",
        productId
      );
      return;
    }

    try {
      const key = "recently_viewed_products";
      const existing = localStorage.getItem(key);
      let ids: number[] = [];

      if (existing) {
        try {
          ids = JSON.parse(existing);
          console.log(
            "[ProductDetails] Existing recently viewed products:",
            ids
          );
        } catch (parseError) {
          console.error(
            "[ProductDetails] Error parsing existing recently viewed products:",
            parseError
          );
          ids = [];
        }
      } else {
        console.log(
          "[ProductDetails] No existing recently viewed products found"
        );
      }

      // Remove if already present
      const filteredIds = ids.filter((id) => id !== productId);
      console.log(
        "[ProductDetails] IDs after removing current product:",
        filteredIds
      );

      // Add to start
      filteredIds.unshift(productId);
      console.log(
        "[ProductDetails] IDs after adding current product to start:",
        filteredIds
      );

      // Keep only latest 20
      const finalIds =
        filteredIds.length > 20 ? filteredIds.slice(0, 20) : filteredIds;
      console.log("[ProductDetails] Final IDs (max 20):", finalIds);

      localStorage.setItem(key, JSON.stringify(finalIds));
      console.log(
        "[ProductDetails] Successfully updated localStorage with recently viewed products:",
        finalIds
      );
    } catch (e) {
      console.error(
        "[ProductDetails] Error updating recently viewed products:",
        e
      );
      // Ignore localStorage errors
    }
  }, [productId]);

  // Function to check pincode deliverability
  const checkPincodeAvailability = async () => {
    if (pincode.length !== 6) {
      // Set a response for invalid PIN code rather than showing nothing
      setPincodeResponse({
        isDeliverable: false,
        message: "Please enter a valid 6-digit PIN code",
        pincode: pincode,
      });
      return;
    }

    try {
      setIsPincodeChecking(true);

      // Pass the product ID to the API for product-specific delivery rules
      const response = await fetch(
        `/api/shipping/check-pincode?pincode=${pincode}&productId=${productId}`
      );

      // Even if the response is not OK, we'll handle it gracefully with UI feedback
      const data = await response.json();
      setPincodeResponse(data);

      // Optionally, save the pincode in localStorage for future use
      localStorage.setItem("last_used_pincode", pincode);
    } catch (error) {
      console.error("Error checking pincode:", error);
      // Instead of showing a toast, set an error response
      setPincodeResponse({
        isDeliverable: false,
        message:
          "Unable to check delivery availability. Please try again later.",
        pincode: pincode,
      });
    } finally {
      setIsPincodeChecking(false);
    }
  };

  // Load previously used pincode from localStorage on component mount
  useEffect(() => {
    const savedPincode = localStorage.getItem("last_used_pincode");
    if (savedPincode) {
      setPincode(savedPincode);
      // Optionally auto-check the pincode
      // We're not auto-checking here to avoid unnecessary API calls
    }
  }, []);

  // Try to use context first if available
  const cartContext = useContext(CartContext);

  // Get user data to check if logged in
  const { data: user } = useQuery<User | null>({
    queryKey: ["/api/user"],
    retry: false,
    staleTime: 60000,
  });

  // Fetch product details with variants
  const {
    data: product,
    isLoading: isProductLoading,
    error: productError,
    isError: isProductError,
  } = useQuery<Product | undefined>({
    // Fix type to allow undefined
    queryKey: ["/api/products", productId],
    queryFn: async () => {
      if (!productId) throw new Error("Product ID is required");

      try {
        // Add variants=true query param to fetch variants data
        const res = await fetch(`/api/products/${productId}?variants=true`, {
          headers: {
            "Cache-Control": "max-age=60",
          },
        });

        if (res.status === 404) {
          return undefined; // Return undefined instead of throwing
        }

        if (!res.ok) {
          console.error("Failed to fetch product details, status:", res.status);
          return undefined; // Return undefined instead of throwing
        }

        const data = await res.json();
        return data;
      } catch (err) {
        console.error("Error fetching product:", err);
        return undefined; // Return undefined instead of throwing
      }
    },
    enabled: !!productId && !isNaN(productId),
    staleTime: 0, // Always consider data stale
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window gains focus
  });

  // Fetch related products
  const { data: relatedProducts, isLoading: isRelatedLoading } = useQuery<
    Product[]
  >({
    queryKey: ["/api/products", { category: product?.category }],
    enabled: !!product?.category,
  });

  // Use formatPrice from utils.ts

  // Create mutations for cart operations
  const addToCartMutation = useMutation({
    mutationFn: async (data: { productId: number; quantity: number }) => {
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

    // Only buyers can add to cart (guests and buyers)
    if (user && user.role !== "buyer") {
      toast({
        title: "Action Not Allowed",
        description:
          "Only buyers can add items to cart. Please switch to a buyer account.",
        variant: "destructive",
      });
      return;
    }

    // If product has both color and size options, require both to be selected
    const hasColor = Array.isArray(uniqueColors) && uniqueColors.length > 0;
    const hasSize = Array.isArray(uniqueSizes) && uniqueSizes.length > 0;
    if (hasColor && hasSize && (!selectedColor || !selectedSize)) {
      toast({
        title: "Selection Required",
        description: "Please select both color and size before adding to cart.",
        variant: "destructive",
      });
      return;
    }

    // Check if the selected variant is out of stock
    if (selectedVariant && selectedVariant.stock <= 0) {
      toast({
        title: "Out of Stock",
        description: "The selected variant is currently out of stock.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Use cart context for both guest and logged-in users
      if (cartContext) {
        if (selectedVariant) {
          const isValidId =
            typeof selectedVariant.id === "number" &&
            selectedVariant.id > 0 &&
            selectedVariant.id < 10000;

          const variantId = isValidId ? selectedVariant.id : product.id;

          cartContext.addToCart(
            {
              ...product,
              id: variantId,
              price: selectedVariant.price,
              mrp: selectedVariant.mrp,
              isVariant: true,
              parentProductId: product.id,
              color: selectedVariant.color,
              size: selectedVariant.size,
            },
            quantity
          );
        } else {
          cartContext.addToCart(product, quantity);
        }
      }
      toast({
        title: "Added to Cart",
        description: `${product.name} ${
          selectedColor ? `(${selectedColor})` : ""
        } ${
          selectedSize ? `(Size: ${selectedSize})` : ""
        } has been added to your cart.`,
        variant: "default",
      });
    } catch (error) {
      console.error("Failed to add to cart:", error);
    }
  };

  // Handle buy now action - simplified approach
  const handleBuyNow = () => {
    if (!product) return;

    // Add validation for variant selection if needed
    if ((product.variants?.length ?? 0) > 0 && !selectedVariant) {
      toast({
        title: "Selection Required",
        description:
          "Please select product options before proceeding to checkout",
        variant: "default",
      });
      return;
    }

    // Check user authentication
    if (!user) {
      toast({
        title: "Please log in",
        description: "You need to be logged in to purchase items",
        variant: "default",
      });
      setLocation("/auth");
      return;
    }

    // Validate user role
    if (user.role !== "buyer") {
      toast({
        title: "Action Not Allowed",
        description:
          "Only buyers can purchase items. Please switch to a buyer account.",
        variant: "destructive",
      });
      return;
    }

    // Check stock availability
    if ((selectedVariant?.stock || product.stock) <= 0) {
      toast({
        title: "Out of Stock",
        description: "This product is currently out of stock.",
        variant: "destructive",
      });
      return;
    }

    // Use traditional add to cart, then redirect approach
    if (cartContext) {
      // Show loading toast
      toast({
        title: "Processing",
        description: "Adding item to your cart...",
        variant: "default",
      });

      // Call add to cart through context
      cartContext.addToCart(product, quantity, selectedVariant);

      // Redirect to checkout after a short delay
      setTimeout(() => {
        window.location.href = "/checkout";
      }, 800);
    } else {
      toast({
        title: "Error",
        description: "Could not access cart features. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Process variants and extract options
  const getVariantOptions = () => {
    if (
      !product ||
      !product.variants ||
      !Array.isArray(product.variants) ||
      product.variants.length === 0
    ) {
      return { uniqueColors: [], uniqueSizes: [], variantMap: new Map() };
    }

    // Extract unique colors and sizes from variants
    const uniqueColors = Array.from(
      new Set(
        product.variants
          .filter((v) => v.color && v.color.trim() !== "")
          .map((v) => v.color)
      )
    );

    const uniqueSizes = Array.from(
      new Set(
        product.variants
          .filter((v) => v.size && v.size.trim() !== "")
          .map((v) => v.size)
      )
    );

    // Create a map for quick lookup of variants by color and size combination
    const variantMap = new Map();

    product.variants.forEach((variant) => {
      const key = `${variant.color || ""}-${variant.size || ""}`;
      variantMap.set(key, variant);
    });

    return { uniqueColors, uniqueSizes, variantMap };
  };

  // Get variant options
  const { uniqueColors, uniqueSizes, variantMap } = getVariantOptions();

  // Function to find available sizes for a selected color
  const getAvailableSizesForColor = (color: string | null) => {
    if (!product?.variants || !color) return uniqueSizes;

    return product.variants
      .filter((v) => v.color === color && v.stock > 0)
      .map((v) => v.size)
      .filter(
        (size, index, self) =>
          size && size.trim() !== "" && self.indexOf(size) === index
      );
  };

  // Function to find available colors for a selected size
  const getAvailableColorsForSize = (size: string | null) => {
    if (!product?.variants || !size) return uniqueColors;

    return product.variants
      .filter((v) => v.size === size && v.stock > 0)
      .map((v) => v.color)
      .filter(
        (color, index, self) =>
          color && color.trim() !== "" && self.indexOf(color) === index
      );
  };

  // Calculate available sizes for the selected color
  const availableSizes = selectedColor
    ? getAvailableSizesForColor(selectedColor)
    : uniqueSizes;

  // Calculate available colors for the selected size
  const availableColors = selectedSize
    ? getAvailableColorsForSize(selectedSize)
    : uniqueColors;

  // Function to find the variant based on selected color and size
  const findMatchingVariant = (color: string | null, size: string | null) => {
    if (!product || !product.variants || !Array.isArray(product.variants))
      return null;

    // If no color or size is selected, return null
    if (!color && !size) return null;

    // Try to find exact match for color and size
    if (color && size) {
      const key = `${color}-${size}`;
      return variantMap.get(key) || null;
    }

    // If only color is selected, find the first variant with that color that has stock
    if (color && !size) {
      return (
        product.variants.find((v) => v.color === color && v.stock > 0) || null
      );
    }

    // If only size is selected, find the first variant with that size that has stock
    if (!color && size) {
      return (
        product.variants.find((v) => v.size === size && v.stock > 0) || null
      );
    }

    return null;
  };

  // Initialize selected variant when product loads
  useEffect(() => {
    if (
      product &&
      product.variants &&
      Array.isArray(product.variants) &&
      product.variants.length > 0
    ) {
      // If there are variants, select the first one by default
      const firstVariant = product.variants[0];
      setSelectedVariant(firstVariant);
      setSelectedColor(firstVariant.color || null);
      setSelectedSize(firstVariant.size || null);
    }
  }, [product]);

  // Update selected variant when color or size changes
  useEffect(() => {
    const matchedVariant = findMatchingVariant(selectedColor, selectedSize);
    if (matchedVariant) {
      setSelectedVariant(matchedVariant);

      // Reset quantity if it's higher than the available stock
      if (quantity > matchedVariant.stock) {
        setQuantity(1);
      }
    } else if (selectedColor || selectedSize) {
      // If we have a selection but no matching variant, reset the selected variant
      setSelectedVariant(null);
    }
  }, [selectedColor, selectedSize, quantity]);

  // Parse specifications string into structured data
  const parseSpecifications = (specs?: string | null) => {
    // Create base specifications array
    let result: { key: string; value: string }[] = [];

    // Add GST information to specifications if available
    if (
      product?.gstDetails &&
      product.gstDetails.gstRate &&
      typeof product.gstDetails.gstRate === "string" &&
      parseFloat(product.gstDetails.gstRate) > 0
    ) {
      result.push({ key: "GST Rate", value: `${product.gstDetails.gstRate}%` });

      if (product.gstDetails.basePrice !== undefined) {
        result.push({
          key: "Base Price",
          value: `₹${product.gstDetails.basePrice.toLocaleString("en-IN")}`,
        });
      }

      if (product.gstDetails.gstAmount !== undefined) {
        result.push({
          key: "GST Amount",
          value: `₹${product.gstDetails.gstAmount.toLocaleString("en-IN")}`,
        });
      }
    }

    // Check if specs is HTML format (from rich text editor)
    if (
      specs &&
      (specs.includes("<p>") || specs.includes("<h") || specs.includes("<ul>"))
    ) {
      // It's already HTML formatted, no need to parse
      return result;
    }

    // Parse product specifications if available and not HTML formatted
    if (specs) {
      const parsedSpecs = specs.split("|").map((spec) => {
        const [key, value] = spec.split(":").map((s) => s.trim());
        return { key, value: value || "" };
      });
      result = [...result, ...parsedSpecs];
    }

    return result;
  };

  // Process images for the product - with a simplified approach
  // When variant images are provided, use ONLY those
  // When no variant images are provided, fall back to product images
  const getProductImages = (
    product?: Product,
    variantImages: string[] = []
  ) => {
    if (!product) return [];

    // Helper function to check problematic URLs
    const isProblematicUrl = (url: string) => {
      return (
        url.includes("placeholder.com") ||
        url.includes("via.placeholder") ||
        url === "null" ||
        url === "undefined" ||
        url === "" ||
        !url
      );
    };

    // If we have variant images, process and use them
    if (variantImages && variantImages.length > 0) {
      // Process any variant images that might be JSON strings
      const processedVariantImages: string[] = [];

      for (const image of variantImages) {
        if (typeof image === "string") {
          // If it looks like JSON, try to parse it
          if (image.startsWith("[") || image.startsWith("{")) {
            try {
              const parsed = JSON.parse(image);
              if (Array.isArray(parsed)) {
                // Handle array of image URLs
                parsed.forEach((item) => {
                  if (typeof item === "string") {
                    processedVariantImages.push(item);
                  } else if (item && typeof item === "object") {
                    // Handle object with url property
                    const imageUrl = item.url || item.imageUrl;
                    if (imageUrl) processedVariantImages.push(imageUrl);
                  }
                });
              } else if (parsed && typeof parsed === "object") {
                // Handle single object with url property
                const imageUrl = parsed.url || parsed.imageUrl;
                if (imageUrl) processedVariantImages.push(imageUrl);
              }
            } catch (e) {
              // If parsing fails but it looks like a URL, add it directly
              if (image.includes("http")) {
                processedVariantImages.push(image);
              }
            }
          } else if (image.includes("http")) {
            // Regular URL, add it directly
            processedVariantImages.push(image);
          }
        }
      }

      // Filter valid images and deduplicate
      const validVariantImages = processedVariantImages.filter(
        (img) =>
          img &&
          typeof img === "string" &&
          img.trim() !== "" &&
          !isProblematicUrl(img)
      );

      if (validVariantImages.length > 0) {
        // Use variant-specific images if we have valid ones
        const uniqueVariantImages = Array.from(new Set(validVariantImages));

        return uniqueVariantImages;
      }
    }

    // Create a new array to store product images
    const images: string[] = [];

    // Main image URL (check imageUrl property and handle potential image_url property)
    const mainImage =
      product.imageUrl || (product as any).image_url || (product as any).image;

    if (
      mainImage &&
      typeof mainImage === "string" &&
      !isProblematicUrl(mainImage)
    ) {
      const imageUrl =
        mainImage.includes("flixcart.com") || mainImage.includes("lelekart.com")
          ? `/api/image-proxy?url=${encodeURIComponent(
              mainImage
            )}&category=${encodeURIComponent(product.category || "general")}`
          : mainImage;
      images.push(imageUrl);
    }

    // Helper function to safely parse JSON
    const safeJsonParse = (jsonString: string) => {
      try {
        return JSON.parse(jsonString);
      } catch (e) {
        console.error("Error parsing JSON:", e);
        return null;
      }
    };

    // Additional images from the images array - without filtering duplicates
    if (product.images) {
      let additionalImages;

      // Safely handle various data formats
      if (typeof product.images === "string") {
        try {
          // First handle the common special format where images are stored as "{url1,url2,url3}"
          if (product.images.includes(",") && product.images.includes("http")) {
            // Try to extract URLs directly with regex
            const urlMatches = product.images.match(/https?:\/\/[^",\\}]+/g);
            if (urlMatches && urlMatches.length > 0) {
              additionalImages = urlMatches;
            }
          }
          // Then try normal JSON parsing if we don't have extracted URLs yet
          else if (
            additionalImages === undefined &&
            ((product.images.trim().startsWith("[") &&
              product.images.trim().endsWith("]")) ||
              (product.images.trim().startsWith("{") &&
                product.images.trim().endsWith("}")))
          ) {
            // Safe JSON parsing - fail silently
            try {
              additionalImages = JSON.parse(product.images);
            } catch (err) {
              // If JSON parsing fails, just continue silently with other methods
            }
          } else {
            // Not a JSON array, treat as a single image URL
            additionalImages = [product.images];
          }
        } catch (err) {
          // Fallback in case any of the above throws an error
        }
      } else {
        // Already an array or object
        additionalImages = product.images;
      }

      // Process the additional images if we have a valid array
      if (Array.isArray(additionalImages)) {
        additionalImages.forEach((img) => {
          if (!img) return;

          // Only process string values
          if (typeof img === "string" && !isProblematicUrl(img)) {
            const imageUrl =
              img.includes("flixcart.com") || img.includes("lelekart.com")
                ? `/api/image-proxy?url=${encodeURIComponent(
                    img
                  )}&category=${encodeURIComponent(
                    product.category || "general"
                  )}`
                : img;

            // Include all images, even if they appear to be duplicates
            // This ensures we show exactly the number of images that exist in the database
            images.push(imageUrl);
          }
        });
      }
    }

    // If no images, use a placeholder based on category
    if (images.length === 0) {
      const categoryLower = (product.category || "general").toLowerCase();
      images.push(`../images/${categoryLower}.svg`);
    }

    return images;
  };

  // Get product price details
  const getPriceDetails = (product?: Product) => {
    if (!product) return { price: 0, discount: 0, original: 0 };

    // If we have a selected variant, use its price and MRP directly
    if (selectedVariant) {
      const variantPrice = selectedVariant.price ?? 0;
      // Use the variant's MRP if present, otherwise fallback to product.mrp
      const variantMrp = selectedVariant.mrp ?? product.mrp ?? 0;
      const variantDiscount = variantMrp - variantPrice;
      console.log("DEBUG VARIANT PRICE BLOCK", {
        selectedVariant,
        variantPrice,
        variantMrp,
      });
      return {
        price: variantPrice,
        discount: variantDiscount,
        original: variantMrp,
        hasGst: product.gstDetails ? true : false,
        gstRate: product.gstDetails?.gstRate,
        basePrice: product.gstDetails?.basePrice,
        gstAmount: product.gstDetails?.gstAmount,
        stock: selectedVariant.stock,
        sku: selectedVariant.sku,
        variantId: selectedVariant.id,
      };
    }

    // Check if product has GST details
    if (product && product.gstDetails) {
      const productPrice =
        product.gstDetails.priceWithGst || product.price || 0;
      // Use product.mrp if available, otherwise fallback to calculated
      const productMrp = product.mrp ?? Math.round(productPrice * 1.25);
      const productDiscount = productMrp - productPrice;
      return {
        price: productPrice,
        discount: productDiscount,
        original: productMrp,
        hasGst: true,
        gstRate: product.gstDetails.gstRate,
        basePrice: product.gstDetails.basePrice,
        gstAmount: product.gstDetails.gstAmount,
      };
    } else {
      // Fallback to regular price calculation
      const price = product.price || 0;
      const mrp = product.mrp ?? Math.round(price * 1.25);
      const discount = mrp - price;
      return { price, discount, original: mrp, hasGst: false };
    }
  };

  // Loading skeleton
  if (isProductLoading) {
    return (
      <>
        <div className="container mx-auto px-4 py-6">
          <div className="bg-white">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              <div className="md:col-span-5 p-4">
                <Skeleton className="w-full h-96" />
                <div className="flex gap-4 mt-6">
                  <Skeleton className="flex-1 h-12" />
                  <Skeleton className="flex-1 h-12" />
                </div>
              </div>
              <div className="md:col-span-7 p-4 space-y-6">
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-4 w-32" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
                <Skeleton className="h-32 w-full" />
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Product not found or error
  if ((!product && !isProductLoading) || isProductError) {
    return (
      <>
        <div className="container mx-auto px-4 py-12">
          <div className="bg-white p-8 text-center rounded shadow-sm">
            <h2 className="text-2xl font-semibold text-gray-800">
              Product not found
            </h2>
            <p className="text-gray-600 mt-2 mb-4">
              {productError instanceof Error
                ? productError.message
                : "The product you're looking for doesn't exist or has been removed."}
            </p>
            <Button onClick={() => setLocation("/")}>Continue Shopping</Button>
          </div>
        </div>
      </>
    );
  }

  // Process images, specifications, price details, colors and sizes
  const productImages = getProductImages(product, selectedVariantImages);

  const specifications = parseSpecifications(product?.specifications);
  const priceDetails = getPriceDetails(product);
  const { price, discount, original, hasGst, gstRate, basePrice, gstAmount } =
    priceDetails;

  // Parse color and size options
  const colorOptions =
    product && product.color ? product.color.split(/,\s*/).filter(Boolean) : [];
  const sizeOptions =
    product && product.size ? product.size.split(/,\s*/).filter(Boolean) : [];

  // --- HARD FILTER: Prevent accidental 0 rendering in GST breakdown ---
  let safeBasePrice =
    typeof basePrice === "number" && basePrice > 0 ? basePrice : undefined;
  let safeGstAmount =
    typeof gstAmount === "number" && gstAmount > 0 ? gstAmount : undefined;

  return (
    <CartProvider>
      <div className="bg-gray-100 min-h-screen">
        {/* Product Header */}
        <div className="bg-offwhite mb-3">
          <div className="container mx-auto px-4 py-3">
            <div className="text-sm text-gray-500">
              Home &gt; {product?.category || "Products"} &gt; {product?.name}
            </div>
          </div>
        </div>

        {/* Product Details Section */}
        <div className="container mx-auto px-2 sm:px-4">
          <div className="bg-offwhite rounded shadow-sm mb-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-0 md:gap-1">
              {/* Left: Product Images (5/12) */}
              <div className="md:col-span-5 p-2 sm:p-4 border-b md:border-b-0 md:border-r border-gray-100">
                <SimpleImageSlider
                  key={`slider-${selectedVariant?.id || "main"}-${selectedColor || "nocolor"}`}
                  images={productImages}
                  name={product?.name || "Product"}
                  selectedVariantImages={selectedVariantImages}
                  selectedVariant={selectedVariant}
                />
              </div>

              {/* Right: Product Info (7/12) */}
              <div className="md:col-span-7 p-2 sm:p-4">
                {/* Product Title with Wishlist Button */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                  <h1 className="text-xl text-gray-800 font-medium break-words">
                    {product?.name}
                  </h1>
                  {product && (
                    <WishlistButton
                      productId={product.id}
                      variant="icon-label"
                      className="text-gray-600 hover:text-primary mt-2 sm:mt-0"
                    />
                  )}
                </div>

                {/* SKU */}
                <div className="flex flex-wrap mt-1 text-sm text-gray-500 gap-2">
                  <span>in {product?.category}</span>
                  {product?.sku && <span className="">SKU: {product.sku}</span>}
                </div>

                {/* Ratings */}
                <div className="flex flex-wrap items-center mt-2 mb-2 gap-2">
                  <div className="flex items-center bg-green-600 text-white px-2 py-0.5 rounded text-xs">
                    <span>4.3</span>
                    <Star className="h-3 w-3 ml-1 fill-current" />
                  </div>
                  <span className="text-gray-500 text-sm">
                    (1,248 Ratings & 235 Reviews)
                  </span>
                  <span className="text-green-600 text-sm ml-auto">
                    Lelekart Assured
                  </span>
                </div>

                {/* Special Offer */}
                <div className="text-green-600 text-sm font-medium">
                  Special Price
                </div>

                {/* Pricing */}
                <div className="flex flex-col mt-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    {typeof price === "number" && price > 0 && (
                      <span className="text-3xl font-medium text-gray-800">
                        {formatPrice(price)}
                      </span>
                    )}
                    {((selectedVariant?.mrp && selectedVariant.mrp > 0) ||
                      (product?.mrp && product?.mrp > 0) ||
                      (original && original > 0)) && (
                      <span className="text-sm text-gray-500 line-through">
                        ₹
                        {(
                          (selectedVariant?.mrp ??
                            product?.mrp ??
                            original) as number
                        )?.toLocaleString("en-IN")}
                      </span>
                    )}
                    {((selectedVariant?.mrp && selectedVariant.mrp > 0) ||
                      (product?.mrp && product?.mrp > 0) ||
                      (original && original > 0)) &&
                      price > 0 && (
                        <span className="text-sm text-green-600">
                          {(() => {
                            const mrp =
                              selectedVariant?.mrp ?? product?.mrp ?? original;
                            return mrp && mrp > 0
                              ? Math.round(((mrp - price) / mrp) * 100)
                              : 0;
                          })()}
                          % off
                        </span>
                      )}
                  </div>
                  {/* GST Breakdown */}
                  {hasGst &&
                    ((typeof gstRate === "string" && parseFloat(gstRate) > 0) ||
                      (typeof gstRate === "number" && gstRate > 0)) &&
                    typeof basePrice === "number" &&
                    basePrice > 0 &&
                    typeof gstAmount === "number" &&
                    gstAmount > 0 && (
                      <div className="text-sm text-gray-600 mt-1 font-medium">
                        Price includes GST ({gstRate}%):{" "}
                        {formatPrice(basePrice + gstAmount)}
                        <span className="text-xs text-gray-500 ml-2">
                          (Base: {formatPrice(basePrice)} + GST:{" "}
                          {formatPrice(gstAmount)})
                        </span>
                      </div>
                    )}
                  {/* Stock availability for selected variant */}
                  {selectedVariant && (
                    <div
                      className={`text-sm mt-2 ${
                        selectedVariant.stock > 0
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {selectedVariant.stock > 0
                        ? selectedVariant.stock <= 5
                          ? "Only a few left in stock!"
                          : "In stock"
                        : "Out of stock"}
                    </div>
                  )}

                  {/* Quantity Selector - Redesigned to match the mockup */}
                  <div className="mt-6">
                    <div className="text-gray-700 font-medium mb-2">
                      Quantity
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-l"
                          title="Decrease quantity"
                          onClick={() => setQuantity(Math.max(1, quantity - 1))}
                          disabled={quantity <= 1}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-10 h-8 bg-white flex items-center justify-center text-lg border-t border-b">
                          {quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-r"
                          title="Increase quantity"
                          onClick={() => {
                            const availableStock =
                              selectedVariant?.stock || product?.stock || 999;
                            setQuantity(Math.min(availableStock, quantity + 1));
                          }}
                          disabled={
                            selectedVariant?.stock
                              ? quantity >= selectedVariant.stock
                              : product?.stock
                                ? quantity >= product.stock
                                : false
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      {((selectedVariant &&
                        selectedVariant.stock > 0 &&
                        quantity >= selectedVariant.stock) ||
                        (!selectedVariant &&
                          product?.stock &&
                          quantity >= product.stock)) && (
                        <div className="text-amber-600 text-sm ml-3">
                          Maximum available quantity selected
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Delivery Options with Shiprocket Pincode Check */}
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4">
                  <div className="sm:col-span-2 text-gray-600 text-sm mb-1 sm:mb-0">
                    Delivery
                  </div>
                  <div className="sm:col-span-10">
                    <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
                      <input
                        className="border border-gray-300 rounded px-2 py-1 w-full sm:w-32 text-sm"
                        placeholder="Enter pincode"
                        type="text"
                        value={pincode}
                        onChange={(e) => {
                          const value = e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 6);
                          setPincode(value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && pincode.length === 6) {
                            checkPincodeAvailability();
                          }
                        }}
                      />
                      <Button
                        variant="ghost"
                        className="text-primary text-sm"
                        onClick={checkPincodeAvailability}
                        disabled={pincode.length !== 6 || isPincodeChecking}
                      >
                        {isPincodeChecking ? (
                          <div className="flex items-center">
                            <div className="animate-spin mr-1">
                              <RotateCw size={14} />
                            </div>
                            Checking...
                          </div>
                        ) : (
                          "Check"
                        )}
                      </Button>
                    </div>
                    {pincodeResponse ? (
                      <div
                        className={`text-sm mt-2 p-2 rounded ${
                          pincodeResponse.isDeliverable
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : "bg-gray-50 text-gray-700 border border-gray-200"
                        }`}
                      >
                        {pincodeResponse.isDeliverable ? (
                          <div className="flex flex-col">
                            <div className="flex items-center">
                              <TruckIcon className="h-4 w-4 mr-1" />
                              <span className="font-medium">
                                Delivery available to{" "}
                                {pincodeResponse.pincode || "this location"}
                              </span>
                            </div>
                            <span className="mt-1">
                              {pincodeResponse.etd
                                ? `Delivery in ${pincodeResponse.etd} days`
                                : "Fast delivery available"}
                              {pincodeResponse.cod_available
                                ? " | Cash on delivery available"
                                : ""}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center">
                            <Info className="h-4 w-4 mr-1 text-gray-500" />
                            <span>{pincodeResponse.message}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-600 text-sm mt-1">
                        Enter your pincode to check delivery availability
                      </div>
                    )}
                  </div>
                </div>

                {/* Product Variants Selection with enhanced VariantSelector component */}
                {product && product.variants && product.variants.length > 0 && (
                  <div className="mt-6">
                    <VariantSelector
                      variants={product.variants}
                      onVariantChange={(variant) => {
                        setSelectedVariant(variant);
                        // ... existing code ...
                      }}
                      onValidSelectionChange={(isValid) => {
                        setIsValidSelection(isValid);
                      }}
                      onVariantImagesChange={(images) => {
                        // ... existing code ...
                      }}
                      onViewVariantImages={(images, variantInfo) => {
                        setModalImages(images);
                        setModalVariantInfo(variantInfo);
                        setVariantImageModalOpen(true);
                      }}
                      showImagePreviews={true}
                      includeStock={true}
                    />
                  </div>
                )}

                {/* Fallback to product color options if no variants have colors */}
                {(!product?.variants || product.variants.length === 0) &&
                  colorOptions.length > 0 && (
                    <div className="mt-6">
                      <div className="text-gray-700 font-medium mb-2">
                        Color
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {colorOptions.map((color, index) => (
                          <button
                            key={index}
                            className={`border shadow-sm rounded-md w-16 h-8 text-sm flex items-center justify-center border-gray-300 hover:border-gray-400 hover:bg-gray-50 ${
                              selectedColor === color
                                ? "border-primary ring-2 ring-primary"
                                : ""
                            }`}
                            onClick={() => {
                              setSelectedColor(color);
                              // ... existing code ...
                            }}
                          >
                            {color}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Highlights & Services */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4">
                  <div className="sm:col-span-2 text-gray-600 text-sm mb-1 sm:mb-0">
                    Highlights
                  </div>
                  <div className="sm:col-span-10">
                    <ul className="text-sm space-y-1">
                      {Array.isArray(specifications)
                        ? specifications.slice(0, 4).map((spec, i) => (
                            <li key={i}>
                              • {spec.key}: {spec.value}
                            </li>
                          ))
                        : null}
                    </ul>
                  </div>
                </div>

                {/* Services */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4">
                  <div className="sm:col-span-2 text-gray-600 text-sm mb-1 sm:mb-0">
                    Services
                  </div>
                  <div className="sm:col-span-10">
                    <div className="text-sm space-y-1">
                      <div className="flex items-center">
                        <TruckIcon className="h-4 w-4 text-primary mr-2" />
                        <span>
                          {Number(product?.returnPolicy) === 0
                            ? "No Return Policy"
                            : `${product?.returnPolicy} Days Return Policy`}
                        </span>
                      </div>
                      {product?.warranty ? (
                        <div className="flex items-center">
                          <Shield className="h-4 w-4 text-primary mr-2" />
                          <span>
                            {product.warranty && product.warranty > 0
                              ? product.warranty % 12 === 0
                                ? `${product.warranty / 12} ${
                                    product.warranty / 12 === 1
                                      ? "Year"
                                      : "Years"
                                  } Warranty`
                                : `${product.warranty} Months Warranty`
                              : "No Warranty"}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex items-center">
                        <Award className="h-4 w-4 text-primary mr-2" />
                        <span>Top Brand</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Seller Info */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4">
                  <div className="sm:col-span-2 text-gray-600 text-sm mb-1 sm:mb-0">
                    Seller
                  </div>
                  <div className="sm:col-span-10">
                    <div className="text-primary text-sm font-medium">
                      {product?.sellerId ? (
                        <Link
                          href={`/seller-products-listing/${product.sellerId}${product.sellerName ? `?sellerName=${encodeURIComponent(product.sellerName)}` : ""}`}
                          className="hover:underline cursor-pointer text-blue-600"
                        >
                          {product?.sellerName ||
                            product?.sellerUsername ||
                            "Seller not found"}
                        </Link>
                      ) : (
                        product?.sellerName ||
                        product?.sellerUsername ||
                        "Seller not found"
                      )}
                    </div>
                    <div className="flex items-center">
                      <div className="flex items-center bg-green-600 text-white px-1.5 py-0.5 rounded text-xs">
                        <span>4.1</span>
                        <Star className="h-2 w-2 ml-0.5 fill-current" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Buttons Section - Only shown in product info section, not duplicated at bottom */}
                <div className="flex flex-col sm:flex-row mt-6 gap-3">
                  <Button
                    size="lg"
                    className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white"
                    onClick={handleAddToCart}
                    disabled={
                      (!isValidSelection &&
                        product?.variants &&
                        product.variants.length > 0) ||
                      (selectedVariant && selectedVariant.stock <= 0)
                    }
                    title="Add to Cart"
                  >
                    <ShoppingCart className="h-5 w-5 mr-2" />
                    {!isValidSelection &&
                    product?.variants &&
                    product.variants.length > 0
                      ? "SELECT OPTIONS"
                      : selectedVariant && selectedVariant.stock <= 0
                        ? "OUT OF STOCK"
                        : "ADD TO CART"}
                  </Button>
                  <Button
                    size="lg"
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={handleBuyNow}
                    disabled={
                      (!isValidSelection &&
                        product?.variants &&
                        product.variants.length > 0) ||
                      (selectedVariant && selectedVariant.stock <= 0)
                    }
                    title="Buy Now"
                  >
                    <Zap className="h-5 w-5 mr-2" />
                    {selectedVariant && selectedVariant.stock <= 0
                      ? "OUT OF STOCK"
                      : "BUY NOW"}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Product Details Tabs */}
          <div className="bg-offwhite rounded shadow-sm mb-3">
            <div className="p-2 sm:p-4">
              <Tabs defaultValue="description">
                <TabsList className="w-full justify-start border-b mb-4 overflow-x-auto whitespace-nowrap">
                  <TabsTrigger value="description">Description</TabsTrigger>
                  <TabsTrigger value="additional">
                    Additional information
                  </TabsTrigger>
                  <TabsTrigger value="specifications">
                    Specifications
                  </TabsTrigger>
                  <TabsTrigger value="variants">Variants</TabsTrigger>
                  <TabsTrigger value="reviews">Reviews</TabsTrigger>
                </TabsList>

                <TabsContent value="description" className="p-2">
                  <h3 className="font-medium text-lg mb-3">
                    Product Description
                  </h3>
                  <RichTextContent
                    content={product?.description || ""}
                    className="text-gray-700"
                  />
                </TabsContent>

                <TabsContent value="additional" className="p-2">
                  <h3 className="font-medium text-lg mb-3">
                    Additional Information
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border rounded text-sm min-w-[350px]">
                      <tbody>
                        <tr className="border-b">
                          <td className="p-3 font-medium w-1/3 bg-gray-50">
                            Weight
                          </td>
                          <td className="p-3">
                            {product?.weight !== undefined &&
                            product?.weight !== null &&
                            product?.weight !== ""
                              ? `${product.weight} g`
                              : "No information available"}
                          </td>
                        </tr>
                        <tr>
                          <td className="p-3 font-medium w-1/3 bg-gray-50">
                            Dimensions
                          </td>
                          <td className="p-3">
                            {product?.length !== undefined &&
                            product?.width !== undefined &&
                            product?.height !== undefined &&
                            product?.length !== null &&
                            product?.width !== null &&
                            product?.height !== null &&
                            product?.length !== "" &&
                            product?.width !== "" &&
                            product?.height !== ""
                              ? `${product.length} × ${product.width} × ${product.height} cm`
                              : "No information available"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                <TabsContent value="specifications" className="p-2">
                  <h3 className="font-medium text-lg mb-3">Specifications</h3>
                  {product?.specifications &&
                  (product.specifications.includes("<p>") ||
                    product.specifications.includes("<h") ||
                    product.specifications.includes("<ul>")) ? (
                    <div className="specifications-content">
                      <RichTextContent
                        content={product.specifications}
                        className="text-gray-700"
                      />
                    </div>
                  ) : (
                    <div className="border rounded overflow-x-auto">
                      <div className="bg-gray-50 p-3 border-b">
                        <h4 className="font-medium">General</h4>
                      </div>
                      <div className="p-0">
                        <table className="w-full min-w-[350px]">
                          <tbody>
                            {Array.isArray(specifications)
                              ? specifications.map((spec, index) => (
                                  <tr
                                    key={index}
                                    className={
                                      index % 2 === 0
                                        ? "bg-white"
                                        : "bg-gray-50"
                                    }
                                  >
                                    <td className="p-3 border-b border-gray-200 w-1/3 text-gray-600">
                                      {spec.key}
                                    </td>
                                    <td className="p-3 border-b border-gray-200">
                                      {spec.value}
                                    </td>
                                  </tr>
                                ))
                              : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="variants" className="p-2">
                  <h3 className="font-medium text-lg mb-3">Product Variants</h3>
                  {product?.variants &&
                  Array.isArray(product.variants) &&
                  product.variants.length > 0 ? (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="min-w-full divide-y divide-gray-200 min-w-[500px]">
                        <thead className="bg-gray-50">
                          <tr>
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Variant Details
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Price
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Stock
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                              SKU
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Images
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {product.variants.map(
                            (variant: any, index: number) => {
                              // ... existing code ...
                            }
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-6 border rounded-md bg-gray-50">
                      <p className="text-gray-500">
                        This product doesn't have any variants.
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="reviews" className="p-2">
                  {productId && <ProductReviews productId={productId} />}
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {/* Similar Products Recommendation Carousel */}
          <div className="bg-offwhite rounded shadow-sm mb-3 p-2 sm:p-4">
            {product && (
              <ProductRecommendationCarousel
                title="Similar Products You May Like"
                description="Based on product characteristics and purchase patterns"
                endpoint={`/api/recommendations/similar/${product.id}`}
                productId={product.id}
                limit={10}
              />
            )}
          </div>

          {/* Personalized Recommendations removed */}
        </div>
      </div>

      {/* Variant Image Modal */}
      <VariantImageModal
        open={variantImageModalOpen}
        onOpenChange={setVariantImageModalOpen}
        images={modalImages}
        variantInfo={modalVariantInfo}
        title={`${product?.name || "Product"} - Variant Images`}
      />
    </CartProvider>
  );
}
