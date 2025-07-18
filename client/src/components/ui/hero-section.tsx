import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ShoppingCart } from "lucide-react";
import { useCart } from "@/context/cart-context";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";

// Hero slider image interface
interface SliderImage {
  url: string;
  alt: string;
  title?: string;
  subtitle?: string;
  buttonText?: string;
  category?: string;
  subcategory?: string;
  badgeText?: string;
  productId?: number;
}

interface HeroSectionProps {
  sliderImages: SliderImage[];
  dealOfTheDay?: {
    title: string;
    subtitle: string;
    image: string;
    originalPrice: number | string;
    discountPrice: number | string;
    discountPercentage: number;
    hours: number;
    minutes: number;
    seconds: number;
    productId?: number; // Added product ID for linking
  };
}

export function HeroSection({ sliderImages, dealOfTheDay }: HeroSectionProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const sliderRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<number | null>(null);
  const [, navigate] = useLocation();
  const { addToCart } = useCart();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Helper function to get category-specific image
  const getCategoryImage = (category?: string) => {
    if (category) {
      const categoryLower = category.toLowerCase();
      // List of known categories with images
      const knownCategories = [
        "electronics",
        "fashion",
        "mobiles",
        "home",
        "beauty",
        "grocery",
        "toys",
        "appliances",
      ];
      if (knownCategories.includes(categoryLower)) {
        return `/images/categories/${categoryLower}.svg`;
      }
    }
    return "/images/placeholder.svg";
  };

  // Helper function to get deal of the day category image
  const getDealCategory = () => {
    // Extract category from subtitle if available
    const category = dealOfTheDay?.subtitle.includes("Electronics")
      ? "electronics"
      : dealOfTheDay?.subtitle.includes("Fashion")
        ? "fashion"
        : dealOfTheDay?.subtitle.includes("Home")
          ? "home"
          : dealOfTheDay?.subtitle.includes("Appliances")
            ? "appliances"
            : dealOfTheDay?.subtitle.includes("Mobiles")
              ? "mobiles"
              : dealOfTheDay?.subtitle.includes("Beauty")
                ? "beauty"
                : dealOfTheDay?.subtitle.includes("Toys")
                  ? "toys"
                  : dealOfTheDay?.subtitle.includes("Grocery")
                    ? "grocery"
                    : "general";

    return `/images/categories/${category}.svg`;
  };

  // Deal of the day countdown - only initialize if we have a deal
  const [countdown, setCountdown] = useState({
    hours: dealOfTheDay?.hours || 0,
    minutes: dealOfTheDay?.minutes || 0,
    seconds: dealOfTheDay?.seconds || 0,
  });

  // Reset countdown when dealOfTheDay changes
  useEffect(() => {
    setCountdown({
      hours: dealOfTheDay?.hours || 0,
      minutes: dealOfTheDay?.minutes || 0,
      seconds: dealOfTheDay?.seconds || 0,
    });
  }, [dealOfTheDay]);

  // Update countdown timer - only if we have a deal of the day
  useEffect(() => {
    if (!dealOfTheDay) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        let newSeconds = prev.seconds - 1;
        let newMinutes = prev.minutes;
        let newHours = prev.hours;

        if (newSeconds < 0) {
          newSeconds = 59;
          newMinutes--;
        }

        if (newMinutes < 0) {
          newMinutes = 59;
          newHours--;
        }

        if (newHours < 0 || (newHours === 0 && newMinutes === 0 && newSeconds === 0)) {
          // When timer ends, refetch the deal and reset timer
          queryClient.invalidateQueries(["/api/deal-of-the-day"]);
          return { hours: 0, minutes: 0, seconds: 0 };
        }

        return { hours: newHours, minutes: newMinutes, seconds: newSeconds };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [dealOfTheDay, queryClient]);

  const goToSlide = (slideIndex: number) => {
    let newIndex = slideIndex;
    if (newIndex < 0) newIndex = sliderImages.length - 1;
    if (newIndex >= sliderImages.length) newIndex = 0;

    setCurrentSlide(newIndex);

    if (sliderRef.current) {
      sliderRef.current.style.transform = `translateX(-${newIndex * 100}%)`;
    }
  };

  const prevSlide = (e: React.MouseEvent) => {
    e.stopPropagation();
    goToSlide(currentSlide - 1);
  };

  const nextSlide = (e: React.MouseEvent) => {
    e.stopPropagation();
    goToSlide(currentSlide + 1);
  };

  const handleSlideClick = (image: SliderImage) => {
    if (image.productId) {
      // Use Wouter navigation instead of direct location change
      navigate(`/product/${image.productId}`);
    } else if (image.category) {
      let url = `/category/${image.category.toLowerCase()}`;
      if (image.subcategory) {
        url += `?subcategory=${image.subcategory.toLowerCase()}`;
      }
      navigate(url);
    }
  };

  // Set up autoplay
  useEffect(() => {
    // Function to advance to the next slide
    const advanceSlide = () => {
      setCurrentSlide((prevSlide) => {
        const nextSlide =
          prevSlide + 1 >= sliderImages.length ? 0 : prevSlide + 1;

        // Update the transform directly
        if (sliderRef.current) {
          sliderRef.current.style.transform = `translateX(-${
            nextSlide * 100
          }%)`;
        }

        return nextSlide;
      });
    };

    // Start autoplay with 5 second intervals
    const autoplayInterval = setInterval(advanceSlide, 5000);

    // Clear interval on component unmount
    return () => clearInterval(autoplayInterval);
  }, [sliderImages.length]); // Only re-run if the number of slides changes

  // Pause autoplay on hover
  const handleMouseEnter = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const handleMouseLeave = () => {
    // Restart the autoplay when mouse leaves
    if (!intervalRef.current) {
      intervalRef.current = window.setInterval(() => {
        const nextSlide =
          currentSlide + 1 >= sliderImages.length ? 0 : currentSlide + 1;
        goToSlide(nextSlide);
      }, 5000);
    }
  };

  const handleDealAddToCart = async () => {
    if (!dealOfTheDay?.productId) return;

    // Check if user is logged in
    if (!user) {
      toast({
        title: "Please log in",
        description: "You need to be logged in to add items to cart",
        variant: "default",
      });
      navigate("/auth");
      return;
    }

    // Check if user is admin or seller
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
      const response = await fetch(`/api/products/${dealOfTheDay.productId}`);
      if (!response.ok) throw new Error("Failed to fetch product");
      const product = await response.json();

      await addToCart(product, 1);
      toast({
        title: "Added to cart",
        description: "The deal of the day has been added to your cart",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add product to cart",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      {/* Main hero slider */}
      <div
        className="relative overflow-hidden bg-gradient-to-r from-blue-500 to-indigo-700"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div
          ref={sliderRef}
          className="flex transition-transform duration-500 ease-in-out"
          style={{ transform: `translateX(-${currentSlide * 100}%)` }}
        >
          {sliderImages.map((image, index) => (
            <div
              key={index}
              className="w-full flex-shrink-0 cursor-pointer"
              onClick={() => handleSlideClick(image)}
            >
              <div className="container mx-auto px-4 py-8 md:py-16 flex flex-col md:flex-row items-center">
                {/* Content area */}
                <div className="md:w-1/2 text-white mb-8 md:mb-0 md:pr-8">
                  {image.badgeText && (
                    <span className="bg-red-500 text-white text-xs font-semibold px-3 py-1 rounded-md uppercase">
                      {image.badgeText}
                    </span>
                  )}
                  <h2 className="text-3xl md:text-5xl font-bold mt-4 leading-tight">
                    {image.title || "Summer Sale Collection"}
                  </h2>
                  <p className="mt-4 text-lg md:text-xl opacity-90 max-w-md">
                    {image.subtitle || "Up to 50% off on all summer essentials"}
                  </p>
                  <Button
                    className="mt-6 bg-white text-blue-600 hover:bg-gray-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSlideClick(image);
                    }}
                  >
                    {image.buttonText || "Shop Now"}
                  </Button>
                </div>

                {/* Image area */}
                <div className="md:w-1/2">
                  <img
                    src={
                      image.url && !image.url.includes("placeholder.com")
                        ? image.url
                        : getCategoryImage(image.category)
                    }
                    alt={image.alt}
                    className="w-full h-64 md:h-80 object-cover rounded-lg shadow-lg bg-gray-50"
                    onError={(e) => {
                      // Use a category-specific fallback image on error
                      const target = e.target as HTMLImageElement;
                      target.onerror = null; // Prevent infinite loop
                      target.src = getCategoryImage(image.category);
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Slider Controls */}
        <Button
          variant="outline"
          size="icon"
          className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-white/80 rounded-full p-2 shadow-lg z-10 hover:bg-white"
          onClick={prevSlide}
        >
          <ChevronLeft className="text-primary" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-white/80 rounded-full p-2 shadow-lg z-10 hover:bg-white"
          onClick={nextSlide}
        >
          <ChevronRight className="text-primary" />
        </Button>

        {/* Indicator Dots */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2">
          {sliderImages.map((_, index) => (
            <button
              key={index}
              className={`w-2 h-2 rounded-full ${
                index === currentSlide ? "bg-white" : "bg-white/50"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                goToSlide(index);
              }}
            />
          ))}
        </div>
      </div>

      {/* Deal of the Day Section - only show if we have deal data */}
      {dealOfTheDay && (
        <div className="bg-gray-50 py-6">
          <div className="container mx-auto px-4">
            <div className="bg-cream rounded-lg shadow-md border border-gray-200 p-4 md:p-6">
              <div className="flex flex-col md:flex-row">
                {/* Left side - Deal info */}
                <div className="md:w-1/2 mb-4 md:mb-0 md:pr-8">
                  <div className="flex items-center mb-4">
                    <div className="bg-red-600 text-white text-xs font-medium px-2 py-1 rounded">
                      DEAL OF THE DAY
                    </div>
                    <div className="flex ml-4 space-x-2">
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-600">
                          {countdown.hours}
                        </div>
                        <div className="text-xs text-gray-500">Hours</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-600">
                          {countdown.minutes}
                        </div>
                        <div className="text-xs text-gray-500">Minutes</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-600">
                          {countdown.seconds}
                        </div>
                        <div className="text-xs text-gray-500">Seconds</div>
                      </div>
                    </div>
                  </div>

                  <h3 className="text-xl font-medium mb-2">
                    {dealOfTheDay.title}
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    {dealOfTheDay.subtitle}
                  </p>

                  <div className="flex items-center mb-4">
                    <span className="text-2xl font-bold">
                      ₹
                      {typeof dealOfTheDay.discountPrice === "number"
                        ? dealOfTheDay.discountPrice.toFixed(2)
                        : typeof dealOfTheDay.discountPrice === "string"
                          ? parseFloat(dealOfTheDay.discountPrice).toFixed(2)
                          : "0.00"}
                    </span>
                    <span className="text-gray-500 line-through ml-2">
                      ₹
                      {typeof dealOfTheDay.originalPrice === "number"
                        ? dealOfTheDay.originalPrice.toFixed(2)
                        : typeof dealOfTheDay.originalPrice === "string"
                          ? parseFloat(dealOfTheDay.originalPrice).toFixed(2)
                          : "0.00"}
                    </span>
                    <span className="text-green-600 ml-2 text-sm">
                      {dealOfTheDay.discountPercentage}% off
                    </span>
                  </div>

                  <Button
                    className="bg-blue-600 hover:bg-blue-700"
                    onClick={handleDealAddToCart}
                    aria-label="Add to Cart"
                    title="Add to Cart"
                  >
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    Add to Cart
                  </Button>
                </div>

                {/* Right side - Product image */}
                <div className="md:w-1/2">
                  <div
                    className="cursor-pointer"
                    onClick={() => {
                      if (dealOfTheDay.productId) {
                        navigate(`/product/${dealOfTheDay.productId}`);
                      }
                    }}
                  >
                    <img
                      src={
                        dealOfTheDay.image &&
                        !dealOfTheDay.image.includes("placeholder.com")
                          ? dealOfTheDay.image
                          : getDealCategory()
                      }
                      alt={dealOfTheDay.title}
                      className="w-full max-h-48 object-contain bg-cream rounded-lg p-2 border border-gray-100"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.onerror = null;
                        target.src = getDealCategory();
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
