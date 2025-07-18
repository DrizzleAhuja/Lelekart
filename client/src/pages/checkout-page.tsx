import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCart } from "@/context/cart-context";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import RazorpayPayment from "@/components/payment/razorpay-payment";
import {
  Home,
  Building2,
  MapPin,
  Phone,
  User,
  Plus,
  Coins,
  AlertCircle,
  ArrowUp,
} from "lucide-react";
import { UserAddress } from "@shared/schema";
import { useWallet } from "@/context/wallet-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useNotifications } from "@/contexts/notification-context";
import { fbq } from "../lib/metaPixel";

// Define form schema with Zod - with more permissive validation
const checkoutSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  // Strict email validation with proper format check
  email: z.string().min(1, { message: "Email is required" }).email({
    message: "Please enter a valid email address (e.g., name@example.com)",
  }),
  phone: z
    .string()
    .min(10, { message: "Phone number must be exactly 10 digits" })
    .max(10, { message: "Phone number must be exactly 10 digits" })
    .regex(/^[0-9]{10}$/, { message: "Phone number must contain only digits" }),
  address: z
    .string()
    .min(20, {
      message: "Address must contain at least 20 alphabetic characters",
    })
    .refine((val) => val.replace(/[^a-zA-Z]/g, "").length >= 20, {
      message: "Address must contain at least 20 alphabetic characters",
    }),
  city: z.string().min(1, { message: "City is required" }),
  state: z.string().min(1, { message: "State is required" }),
  zipCode: z
    .string()
    .min(6, { message: "PIN code must be exactly 6 digits" })
    .max(6, { message: "PIN code must be exactly 6 digits" })
    .regex(/^[0-9]{6}$/, { message: "PIN code must contain only digits" }),
  paymentMethod: z.enum(["cod", "razorpay"], {
    required_error: "Please select a payment method",
  }),
  notes: z.string().optional().default(""),
});

type CheckoutFormValues = z.infer<typeof checkoutSchema>;

interface CartItem {
  id: number;
  quantity: number;
  userId: number;
  product: {
    id: number;
    name: string;
    description: string;
    price: number;
    imageUrl: string;
    images: string;
    category: string;
    sellerId: number;
    approved: boolean;
    createdAt: string;
    specifications?: string;
    purchasePrice?: number;
    color?: string;
    size?: string;
    stock: number;
    deliveryCharges?: number;
  };
}

export default function CheckoutPage() {
  const [loading, setLoading] = useState(true);
  const [processingOrder, setProcessingOrder] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [showAddressForm, setShowAddressForm] = useState(true);
  const [useWalletCoins, setUseWalletCoins] = useState(false);
  const [walletDiscount, setWalletDiscount] = useState(0);
  const [walletError, setWalletError] = useState<string | undefined>(undefined);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const {
    wallet,
    settings,
    isLoading: isWalletLoading,
    refetchWallet,
  } = useWallet();
  const { cartItems, validateCart, clearCart, cleanupInvalidCartItems } =
    useCart();
  const { refetchNotifications } = useNotifications();

  // State for direct checkout data from localStorage
  const [directCheckoutData, setDirectCheckoutData] = useState<any>(null);
  const [isDirectCheckout, setIsDirectCheckout] = useState(false);

  // Initialize form with default values including email from user if available
  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      name: "",
      email: user?.email ?? user?.username ?? "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      paymentMethod: "cod",
      notes: "",
    },
    // Set form to always be valid when using saved addresses to prevent validation issues
    mode: "onChange",
  });

  const [voucher, setVoucher] = useState<{
    code: string;
    value: number;
  } | null>(null);

  // Calculate subtotal and delivery charges (put this at the top, NOT inside JSX)
  const subtotal = cartItems.reduce((total, item) => {
    const price = item.variant ? item.variant.price : item.product.price;
    return total + price * item.quantity;
  }, 0);
  const deliveryCharges = cartItems.reduce((total, item) => {
    const charge = item.product.deliveryCharges ?? 0;
    return total + charge * item.quantity;
  }, 0);

  // Calculate max redeemable coins for this order (5% of redeemedBalance)
  const maxRedeemableFromRedeemed =
    wallet && settings
      ? Math.min(
          Math.floor((subtotal + deliveryCharges) * 0.05),
          wallet.redeemedBalance
        )
      : 0;
  const [redeemAmount, setRedeemAmount] = useState(0);
  const [useRedeemedCoins, setUseRedeemedCoins] = useState(false);

  // Show scroll-to-top button only when scrolled down
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 200);
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Fetch user data
  useEffect(() => {
    // Check if user is already cached
    const cachedUser = queryClient.getQueryData<any>(["/api/user"]);
    if (cachedUser) {
      setUser(cachedUser);
      // Pre-fill form with user data if available
      form.setValue("name" as any, cachedUser.name || "");
      form.setValue("email" as any, cachedUser.email || "");
      form.setValue("phone" as any, cachedUser.phone || "");
      form.setValue("address" as any, cachedUser.address || "");
    }

    // Fetch fresh user data
    fetch("/api/user", {
      credentials: "include",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    })
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((userData) => {
        if (userData) {
          setUser(userData);
          queryClient.setQueryData(["/api/user"], userData);
          // Pre-fill form with user data if available
          form.setValue("name" as any, userData.name || "");
          form.setValue("email" as any, userData.email || "");
          form.setValue("phone" as any, userData.phone || "");
          form.setValue("address" as any, userData.address || "");

          // Fetch user addresses
          fetchUserAddresses();

          // Mark as loaded since we're using CartContext for cart items
          setLoading(false);
        } else {
          setLoading(false);
          setLocation("/auth");
        }
      })
      .catch((err) => {
        console.error("Error fetching user:", err);
        setLoading(false);
      });
  }, [form]);

  // Fetch user addresses
  const fetchUserAddresses = () => {
    fetch("/api/addresses", {
      credentials: "include",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    })
      .then((res) => res.json())
      .then((data) => {
        setAddresses(data);

        // If user has addresses, show address selection instead of the form
        if (data.length > 0) {
          setShowAddressForm(false);

          // Get default address if exists
          const defaultAddress = data.find(
            (addr: UserAddress) => addr.isDefault
          );
          const addressToUse = defaultAddress || data[0];

          setSelectedAddressId(addressToUse.id.toString());

          // Get email value for the address
          const emailValue = user?.email ?? user?.username ?? "";

          // Reset the form with all necessary values and explicit validation options
          form.reset(
            {
              name: addressToUse.fullName,
              phone: addressToUse.phone,
              address: addressToUse.address,
              city: addressToUse.city,
              state: addressToUse.state,
              zipCode: addressToUse.pincode,
              email: emailValue,
              paymentMethod: "cod",
              notes: "",
            },
            {
              keepIsValid: true,
              keepDirty: false,
              keepTouched: false,
            }
          );

          // Clear any validation errors
          Object.keys(form.getValues()).forEach((fieldName) => {
            form.clearErrors(fieldName as any);
          });

          // Force validation to succeed for default addresses - using same approach as in onClick
          setTimeout(() => {
            console.log("Setting all fields as valid for default address");

            // First clear all errors
            form.clearErrors();

            // Then manually mark all required fields as valid
            [
              "name",
              "phone",
              "address",
              "city",
              "state",
              "zipCode",
              "email",
              "paymentMethod",
            ].forEach((field) => {
              // This is necessary to ensure the field is properly validated
              form.trigger(field as any);

              // Double-check that no errors remain
              form.clearErrors(field as any);
            });

            console.log("Form validation complete for default address");
          }, 100);

          console.log(
            `${defaultAddress ? "Default" : "First"} address selected, form reset with values:`,
            {
              name: addressToUse.fullName,
              email: emailValue,
              isValid: form.formState.isValid,
            }
          );
        }
      })
      .catch((err) => {
        console.error("Error fetching addresses:", err);
      });
  };

  // No need for fetchCartItems function as we're now using cartItems from CartContext

  // Check if cart is empty and redirect if needed
  useEffect(() => {
    // Check URL to see if we need to skip the empty cart check
    const fromBuyNow = window.location.search.includes("buynow=true");

    if (!loading && cartItems.length === 0 && !fromBuyNow) {
      console.log("Empty cart detected in checkout page, redirecting to cart");
      toast({
        title: "Empty Cart",
        description:
          "Your cart is empty. Please add items before proceeding to checkout.",
        variant: "destructive",
      });
      setLocation("/cart");
    } else if (!loading) {
      console.log(
        `Checkout page loaded with ${cartItems.length} items in cart or from Buy Now flow (skip redirect: ${fromBuyNow})`
      );
    }
  }, [loading, cartItems, setLocation, toast]);

  // Verify cart with server on page load
  useEffect(() => {
    if (!loading && user && cartItems.length > 0) {
      console.log("Verifying cart contents with server on checkout page load");
      // Adding a delay to ensure we're getting fresh data after any redirects
      const timer = setTimeout(async () => {
        try {
          // Force a fresh fetch of cart contents from server
          const response = await fetch("/api/cart", {
            method: "GET",
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          });

          if (!response.ok) {
            throw new Error("Failed to verify cart contents");
          }

          const serverCart = await response.json();
          console.log("Server cart verification:", serverCart.length, "items");

          // If server shows empty cart but client has items, invalidate client cache
          if (serverCart.length === 0 && cartItems.length > 0) {
            console.log(
              "MISMATCH: Server shows empty cart but client shows items"
            );
            queryClient.invalidateQueries({ queryKey: ["/api/cart"] });

            toast({
              title: "Cart Error",
              description:
                "Your cart appears to be empty on the server. Refreshing cart data.",
              variant: "destructive",
            });

            // Redirect to cart page after a brief delay
            setTimeout(() => setLocation("/cart"), 1500);
          }
        } catch (error) {
          console.error("Error verifying cart with server:", error);
        }
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [loading, user, cartItems.length, queryClient, setLocation, toast]);

  // Check if wallet can be applied to this order
  const checkWalletEligibility = () => {
    if (!wallet || !settings) return false;

    // Check if wallet system is active
    if (!settings.isActive) {
      setWalletError("Wallet system is currently disabled");
      return false;
    }

    // Check if user has any wallet rupees
    if (!wallet.balance || wallet.balance <= 0) {
      setWalletError("You don't have any wallet rupees in your wallet");
      return false;
    }

    // Check if cart meets minimum order value
    if (settings.minCartValue && subtotal < settings.minCartValue) {
      setWalletError(
        `Wallet rupees can only be used on orders worth ₹${settings.minCartValue} or more`
      );
      return false;
    }

    // Check if all products are in applicable categories
    if (
      settings.applicableCategories &&
      settings.applicableCategories.trim() !== ""
    ) {
      const applicableCategories = settings.applicableCategories
        .split(",")
        .map((cat) => cat.trim().toLowerCase());

      // Check if at least one product is in applicable categories
      const hasEligibleProduct = cartItems.some((item) =>
        applicableCategories.includes(item.product.category.toLowerCase())
      );

      if (!hasEligibleProduct) {
        setWalletError(
          `Wallet rupees can only be used on these categories: ${settings.applicableCategories}`
        );
        return false;
      }
    }

    setWalletError(undefined);
    return true;
  };

  // Calculate maximum allowed wallet discount and coins
  const calculateMaxWalletDiscount = () => {
    if (!wallet || !settings || !settings.isActive || wallet.balance <= 0)
      return { maxDiscount: 0, maxCoins: 0 };
    const conversionRate = 1; // 1 coin = 1 rupee
    const maxCoinValue = wallet.balance * conversionRate;
    // Use subtotal + deliveryCharges for max usage percentage
    const orderTotal = subtotal + deliveryCharges;
    let maxPercentageDiscount = maxCoinValue;
    if (settings.maxUsagePercentage && settings.maxUsagePercentage > 0) {
      maxPercentageDiscount = orderTotal * (settings.maxUsagePercentage / 100);
    }
    const finalDiscount = Math.min(maxCoinValue, maxPercentageDiscount);
    const maxCoins = Math.floor(finalDiscount / conversionRate);
    return { maxDiscount: finalDiscount, maxCoins };
  };

  // Calculate wallet discount
  const { maxDiscount: maxWalletDiscount, maxCoins: maxWalletCoins } =
    calculateMaxWalletDiscount();

  // Coupon code state
  const [couponCode, setCouponCode] = useState("");
  const [couponError, setCouponError] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  // Coupon discount state
  const [couponDiscount, setCouponDiscount] = useState(0);

  // Coupon apply handler
  const handleApplyCoupon = async () => {
    setCouponError("");
    setCouponLoading(true);
    setAppliedCoupon(null);
    setCouponDiscount(0);
    if (!couponCode.trim()) {
      setCouponError("Please enter a coupon code.");
      setCouponLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/admin/affiliates?code=${encodeURIComponent(couponCode.trim())}`
      );
      if (!res.ok) throw new Error("Invalid coupon code");
      const affiliate = await res.json();
      if (!affiliate || !affiliate.discountPercentage) {
        setCouponError("Invalid or inactive coupon code.");
        setCouponLoading(false);
        return;
      }
      setAppliedCoupon(affiliate);
      setCouponDiscount(affiliate.discountPercentage);
      setCouponError("");
    } catch (err) {
      setCouponError("Invalid or inactive coupon code.");
    } finally {
      setCouponLoading(false);
    }
  };

  // Add a handler to remove the applied coupon
  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponDiscount(0);
    setCouponCode("");
    setCouponError("");
  };

  // Calculate coupon discount
  const couponDiscountAmount = appliedCoupon
    ? Math.round(
        (subtotal + deliveryCharges) * (appliedCoupon.discountPercentage / 100)
      )
    : 0;

  // The final total after wallet, redeem, and coupon discount
  const finalOrderTotal =
    subtotal +
    deliveryCharges -
    (useWalletCoins && walletDiscount > 0 ? walletDiscount : 0) -
    (useRedeemedCoins ? redeemAmount : 0) -
    (appliedCoupon ? couponDiscountAmount : 0);

  // Update wallet discount state only when checkbox is checked and wallet is eligible
  useEffect(() => {
    if (cartItems.length === 0 || !wallet || !settings) return;
    if (useWalletCoins) {
      if (checkWalletEligibility()) {
        setWalletDiscount(maxWalletDiscount);
      } else {
        setWalletDiscount(0);
      }
    } else {
      setWalletDiscount(0);
    }
  }, [useWalletCoins, wallet, settings, cartItems, subtotal]);

  // Fetch active wallet voucher for user on mount
  useEffect(() => {
    async function fetchVoucher() {
      const res = await fetch("/api/gift-cards/active-wallet-voucher", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.code && data.currentBalance > 0) {
          setVoucher({ code: data.code, value: data.currentBalance });
        }
      }
    }
    fetchVoucher();
  }, []);

  // Remove max usage percentage logic and add input for wallet points
  // 1. Add state for wallet points input
  const [walletPointsInput, setWalletPointsInput] = useState(0);

  // 2. Calculate max wallet points user can use (min of wallet.balance and subtotal+deliveryCharges)
  const maxWalletPoints = wallet
    ? Math.min(wallet.balance, subtotal + deliveryCharges)
    : 0;

  // 3. Update wallet discount and total in real-time
  useEffect(() => {
    if (useWalletCoins && wallet && maxWalletPoints > 0) {
      const validPoints = Math.max(
        0,
        Math.min(walletPointsInput, maxWalletPoints)
      );
      setWalletDiscount(validPoints); // 1 point = 1 rupee
    } else {
      setWalletDiscount(0);
    }
  }, [
    useWalletCoins,
    walletPointsInput,
    maxWalletPoints,
    wallet,
    subtotal,
    deliveryCharges,
  ]);

  // 1. Add state for reward points input
  const [rewardPointsInput, setRewardPointsInput] = useState(0);

  // 2. Calculate max reward points user can use (min of 5% of order total and reward points balance)
  const orderTotal = subtotal + deliveryCharges;
  const maxRewardPoints =
    user && user.rewardPoints !== undefined
      ? Math.min(Math.floor(orderTotal * 0.05), user.rewardPoints)
      : 0;

  // 3. Update reward discount and total in real-time
  const [rewardDiscount, setRewardDiscount] = useState(0);
  useEffect(() => {
    if (rewardPointsInput > 0 && maxRewardPoints > 0) {
      const validPoints = Math.max(
        0,
        Math.min(rewardPointsInput, maxRewardPoints)
      );
      setRewardDiscount(validPoints); // 1 point = 1 rupee
    } else {
      setRewardDiscount(0);
    }
  }, [rewardPointsInput, maxRewardPoints]);

  // 4. In the UI, show input box for reward points if user has reward points
  {
    user && user.rewardPoints > 0 && (
      <div className="my-4 border rounded-md p-3 bg-blue-50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium flex items-center cursor-pointer">
              🎁 Use Reward Points ({user.rewardPoints} points)
            </label>
          </div>
          {maxRewardPoints > 0 && (
            <span className="text-xs text-blue-600 font-medium">
              Up to {maxRewardPoints} points (5% of order total)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input
            type="number"
            min={0}
            max={maxRewardPoints}
            value={rewardPointsInput}
            onChange={(e) => {
              const val = Math.max(
                0,
                Math.min(maxRewardPoints, Number(e.target.value))
              );
              setRewardPointsInput(val);
            }}
            className="border rounded px-2 py-1 w-24"
            placeholder={`Max ${maxRewardPoints}`}
          />
          <span className="text-xs text-gray-500">
            Enter reward points to use
          </span>
        </div>
      </div>
    );
  }

  // Handle form submission
  const onSubmit = async (values: CheckoutFormValues) => {
    setProcessingOrder(true);

    // Debug validation
    console.log("Form values being submitted:", values);
    console.log("Form validation state:", form.formState);

    // First validate that all cart items are valid and still in the database
    try {
      console.log("Starting cart validation before checkout");

      // Use the validateCart function from CartContext
      const isValid = await validateCart();

      if (!isValid) {
        console.error(
          "Cart validation failed - invalid items were found and removed"
        );

        // Use our new cleanupInvalidCartItems function to automatically clean up invalid items
        const cleanupSuccess = await cleanupInvalidCartItems();

        if (!cleanupSuccess) {
          console.error(
            "Cart cleanup failed - redirecting to cart page for manual review"
          );
          toast({
            title: "Cart Issues",
            description:
              "There are issues with items in your cart that require your attention. Please review your cart before proceeding.",
            variant: "destructive",
          });

          // Redirect to cart page for manual review
          setLocation("/cart");
          setProcessingOrder(false);
          return;
        }

        // Check if cart is now empty after removing invalid items
        if (cartItems.length === 0) {
          toast({
            title: "Empty Cart",
            description:
              "All items in your cart were invalid and have been removed. Please add new items before checkout.",
            variant: "destructive",
          });
          // Redirect to home page if cart is now empty
          setLocation("/");
          setProcessingOrder(false);
          return;
        }

        // Let's try validating again after cleanup
        console.log("Performing second validation after cleanup");
        const secondValidation = await validateCart();
        if (!secondValidation) {
          console.error("Cart still contains invalid items after cleanup");
          toast({
            title: "Checkout Error",
            description:
              "There are persistent issues with your cart that couldn't be fixed automatically. Please try again later or contact support.",
            variant: "destructive",
          });
          setProcessingOrder(false);
          return;
        }

        console.log("Cart validation successful - proceeding with checkout");
      }

      // For saved addresses, we'll ensure we have the correct information
      // regardless of form validation state
      if (addresses.length > 0 && selectedAddressId && !showAddressForm) {
        console.log(
          "Using saved address for order - bypassing validation checks"
        );

        // Get the selected address details
        const selectedAddress = addresses.find(
          (a) => a.id.toString() === selectedAddressId
        );
        if (selectedAddress) {
          // Override the values from the form with the values from the saved address
          // This ensures we always have the correct address data
          values.name = selectedAddress.fullName;
          values.phone = selectedAddress.phone;
          values.address = selectedAddress.address;
          values.city = selectedAddress.city;
          values.state = selectedAddress.state;
          values.zipCode = selectedAddress.pincode;

          // Make sure we have an email
          if (!values.email) {
            values.email = user?.email ?? user?.username ?? undefined;
          }
        }
      }

      try {
        // Validate wallet usage if attempting to use wallet coins
        if (useWalletCoins && wallet) {
          if (!checkWalletEligibility()) {
            toast({
              title: "Wallet Error",
              description:
                walletError ??
                "Unable to apply wallet discount. Please check requirements.",
              variant: "destructive",
            });
            setProcessingOrder(false);
            return;
          }
        }

        // Prepare order data
        const orderData: any = {
          userId: user.id,
          // Use the final total after all discounts
          total: finalOrderTotal,
          // status is removed from client request and will be set by server
          paymentMethod: values.paymentMethod,
          shippingDetails: JSON.stringify({
            name: values.name,
            email: values.email,
            phone: values.phone,
            address: values.address,
            city: values.city,
            state: values.state,
            zipCode: values.zipCode,
            notes: values.notes,
          }),
        };

        // Add address ID if using saved address
        if (addresses.length > 0 && selectedAddressId && !showAddressForm) {
          orderData.addressId = parseInt(selectedAddressId);
        }

        // Add wallet discount information if applicable
        if (useWalletCoins && walletDiscount > 0) {
          orderData.walletDiscount = walletDiscount;
          orderData.walletCoinsUsed = walletDiscount; // 1 point = 1 rupee
        }
        // Add redeem discount information if applicable
        if (useRedeemedCoins && redeemAmount > 0) {
          orderData.redeemDiscount = redeemAmount;
          orderData.redeemCoinsUsed = redeemAmount; // 1 coin = 1 rupee
        }
        // Add reward discount information (always send, even if zero)
        orderData.rewardDiscount = rewardPointsInput;
        orderData.rewardPointsUsed = rewardPointsInput;

        // Add coupon info if applied
        if (appliedCoupon) {
          orderData.couponCode = appliedCoupon.code;
          orderData.couponDiscount = couponDiscountAmount;
        }

        // Log order data before submission
        console.log("Submitting order with data:", orderData);

        // Create order
        const orderResponse = await fetch("/api/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          credentials: "include",
          body: JSON.stringify(orderData),
        });

        if (!orderResponse.ok) {
          const errorData = await orderResponse.json().catch(() => ({}));
          console.error("Error placing order:", errorData);
          throw new Error("Failed to create order");
        }

        const order = await orderResponse.json();

        // If a coupon was applied, increment its usage count
        if (appliedCoupon && appliedCoupon.id) {
          try {
            await fetch(`/api/admin/affiliates/${appliedCoupon.id}/increment-usage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
          } catch (err) {
            console.error('Failed to increment affiliate usage:', err);
          }
        }

        // Refetch notifications so the buyer sees the order placed notification
        await refetchNotifications();

        // If wallet coins were used, process the redemption
        if (useWalletCoins && walletDiscount > 0 && wallet) {
          const coinsUsed = Math.ceil(
            walletDiscount / (settings?.conversionRate || 0.1)
          );
          try {
            // Make API call to redeem coins
            await fetch("/api/wallet/redeem", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              credentials: "include",
              body: JSON.stringify({
                amount: coinsUsed,
                referenceType: "ORDER",
                referenceId: String(order.id || ""),
                description: String(`Used for order #${order.id}` || ""),
              }),
            });
            console.log(
              `Successfully redeemed ${coinsUsed} coins for order #${order.id}`
            );
          } catch (err) {
            console.error("Error redeeming wallet coins:", err);
            // We still proceed with the order even if coin redemption fails
          }
        }

        // Use the clearCart function from the CartContext hook to clear the cart
        try {
          // Call the clearCart function directly from the hook
          await clearCart();
          console.log("Cart cleared successfully after order placement");

          // Ensure the React Query cache is invalidated
          queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
        } catch (error) {
          console.error("Error clearing cart:", error);
          // Continue with order process even if cart clearing fails
        }

        // Show success message
        toast({
          title: "Order Placed Successfully",
          description:
            "Your order has been placed successfully. Your cart has been cleared. Thank you for shopping with us!",
        });

        // Place this after order is successfully placed and before redirect/clear cart
        refetchWallet && refetchWallet();

        // Redirect to order confirmation page with success parameter and total
        setLocation(
          `/order-confirmation/${order.id}?success=true&total=${finalOrderTotal}`
        );
      } catch (error) {
        console.error("Error placing order:", error);
        toast({
          title: "Order Failed",
          description:
            "There was an error placing your order. Please try again.",
          variant: "destructive",
        });
        setProcessingOrder(false);
      }
    } catch (error) {
      console.error("Error during cart validation:", error);
      toast({
        title: "Checkout Error",
        description: "Failed to validate cart items. Please try again.",
        variant: "destructive",
      });
      setProcessingOrder(false);
      return;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  console.log(
    "useWalletCoins:",
    useWalletCoins,
    "walletDiscount:",
    walletDiscount,
    "finalOrderTotal:",
    finalOrderTotal
  );
  return (
    <div className="container mx-auto py-8 px-2 sm:px-4 bg-[#f5e7d4]">
      <h1 className="text-2xl font-bold mb-8 text-center sm:text-left text-black">
        Checkout
      </h1>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Shipping Form */}
        <div className="w-full md:w-2/3">
          <div className="bg-white/90 rounded-2xl shadow-xl p-2 sm:p-6">
            <h2 className="text-lg font-semibold mb-6">Shipping Information</h2>

            {addresses.length > 0 && (
              <div className="mb-6">
                <h3 className="font-medium text-base mb-4">
                  Select Delivery Address
                </h3>

                <div className="grid grid-cols-1 gap-4 mb-4">
                  {addresses.map((address) => (
                    <div
                      key={address.id}
                      className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                        selectedAddressId === address.id.toString()
                          ? "border-primary bg-primary/5"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                      onClick={() => {
                        console.log(`Clicked on address ID: ${address.id}`);
                        setSelectedAddressId(address.id.toString());

                        // Get email value
                        const emailValue = user?.email ?? user?.username ?? "";

                        try {
                          // Clear all validation errors by resetting form with new values
                          form.reset(
                            {
                              name: address.fullName,
                              phone: address.phone,
                              address: address.address,
                              city: address.city,
                              state: address.state,
                              zipCode: address.pincode,
                              email: emailValue,
                              paymentMethod:
                                form.getValues("paymentMethod") || "cod",
                              notes: form.getValues("notes") || "",
                            },
                            {
                              // This is crucial - ensures the form is considered valid after reset
                              keepIsValid: true,
                              keepDirty: false,
                              keepTouched: false,
                            }
                          );

                          // Set all fields as valid manually to ensure the form is valid
                          Object.keys(form.getValues()).forEach((fieldName) => {
                            form.clearErrors(fieldName as any);
                          });

                          // Force validation to succeed for selected addresses
                          setTimeout(() => {
                            // Set all fields as valid directly
                            console.log(
                              "Setting all fields as valid for address selection"
                            );

                            // First clear all errors
                            form.clearErrors();

                            // Then manually mark all required fields as valid
                            [
                              "name",
                              "phone",
                              "address",
                              "city",
                              "state",
                              "zipCode",
                              "email",
                              "paymentMethod",
                            ].forEach((field) => {
                              // This is necessary to ensure the field is properly validated
                              form.trigger(field as any);

                              // Double-check that no errors remain
                              form.clearErrors(field as any);
                            });

                            console.log(
                              "Form validation complete for address selection"
                            );
                          }, 100);
                        } catch (error) {
                          console.error("Error resetting form:", error);
                        }

                        // Log for debugging
                        console.log(
                          "Address selected, form reset with values:",
                          {
                            name: address.fullName,
                            email: emailValue,
                            formState: form.formState,
                          }
                        );
                      }}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center">
                          <span className="font-semibold">
                            {address.addressName}
                          </span>
                          {address.isDefault && (
                            <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                              Default
                            </span>
                          )}
                        </div>
                        {selectedAddressId === address.id.toString() && (
                          <div className="w-4 h-4 rounded-full bg-primary"></div>
                        )}
                      </div>
                      <div className="text-sm text-gray-700 mb-1">
                        <User className="inline-block h-3 w-3 mr-1" />
                        {address.fullName}
                      </div>
                      <div className="text-sm text-gray-700 mb-1">
                        <MapPin className="inline-block h-3 w-3 mr-1" />
                        {address.address}, {address.city}, {address.state},{" "}
                        {address.pincode}
                      </div>
                      <div className="text-sm text-gray-700">
                        <Phone className="inline-block h-3 w-3 mr-1" />
                        {address.phone}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center mb-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddressForm(!showAddressForm)}
                  >
                    {showAddressForm ? "Hide Form" : "Enter New Address"}
                  </Button>
                  <span className="text-sm text-gray-500 ml-2">
                    {showAddressForm
                      ? "Fill in the form below"
                      : "Or use a different address"}
                  </span>
                </div>

                <div className={`${showAddressForm ? "block" : "hidden"}`}>
                  <div className="border-t border-dashed my-4"></div>
                  <h3 className="font-medium text-base mb-4">
                    Or Enter New Address
                  </h3>
                </div>
              </div>
            )}

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                {/* Address entry section - conditionally shown/hidden */}
                <div
                  style={{
                    display:
                      addresses.length > 0 && !showAddressForm
                        ? "none"
                        : "block",
                  }}
                >
                  <div className="address-form-section mb-8">
                    <h3 className="font-medium text-base mb-4">
                      Shipping Address
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input placeholder="John Doe" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder="john@example.com"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="1234567890"
                              {...field}
                              maxLength={10}
                              onKeyPress={(e) => {
                                // Allow only digits
                                if (!/[0-9]/.test(e.key)) {
                                  e.preventDefault();
                                }
                              }}
                              onChange={(e) => {
                                // Only allow digits in the field
                                const value = e.target.value.replace(
                                  /[^0-9]/g,
                                  ""
                                );
                                e.target.value = value;
                                field.onChange(value);
                              }}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            Enter a 10-digit number without spaces or special
                            characters
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="123 Main St, Apt 4B"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                      <FormField
                        control={form.control}
                        name="zipCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>PIN Code</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="123456"
                                {...field}
                                maxLength={6}
                                onKeyPress={(e) => {
                                  // Allow only digits
                                  if (!/[0-9]/.test(e.key)) {
                                    e.preventDefault();
                                  }
                                }}
                                onChange={(e) => {
                                  // Only allow digits in the field
                                  const value = e.target.value.replace(
                                    /[^0-9]/g,
                                    ""
                                  );
                                  e.target.value = value;

                                  field.onChange(value);

                                  // Auto-populate city and state when pincode has 6 digits
                                  if (value && value.length === 6) {
                                    console.log(
                                      "Fetching data for checkout pincode:",
                                      value
                                    );
                                    fetch(`/api/pincode/${value}`)
                                      .then((response) => {
                                        console.log(
                                          "Checkout Pincode API response:",
                                          response.status
                                        );
                                        if (!response.ok) {
                                          throw new Error("PIN code not found");
                                        }
                                        return response.json();
                                      })
                                      .then((data) => {
                                        console.log(
                                          "Checkout Pincode data received:",
                                          data
                                        );
                                        // Update the state and city fields
                                        form.setValue(
                                          "state" as any,
                                          data.state || "",
                                          { shouldValidate: true }
                                        );
                                        form.setValue(
                                          "city" as any,
                                          data.district || "",
                                          { shouldValidate: true }
                                        );
                                        // Clear any existing PIN code error
                                        form.clearErrors("zipCode" as any);
                                      })
                                      .catch((error) => {
                                        console.error(
                                          "Error fetching location data:",
                                          error
                                        );
                                        // Show error for invalid PIN code
                                        form.setError("zipCode" as any, {
                                          type: "manual",
                                          message:
                                            "Invalid PIN code. Please enter a valid PIN code.",
                                        });

                                        // Clear city and state fields
                                        form.setValue("state" as any, "", {
                                          shouldValidate: true,
                                        });
                                        form.setValue("city" as any, "", {
                                          shouldValidate: true,
                                        });

                                        // Show toast notification for invalid PIN
                                        toast({
                                          title: "Invalid PIN Code",
                                          description:
                                            "The PIN code you entered is not valid. Please check and try again.",
                                          variant: "destructive",
                                        });
                                      });
                                  } else if (value.length < 6) {
                                    // Clear city and state when PIN is incomplete
                                    form.setValue("state" as any, "", {
                                      shouldValidate: false,
                                    });
                                    form.setValue("city" as any, "", {
                                      shouldValidate: false,
                                    });
                                  }
                                }}
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Enter a 6-digit PIN code
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="New York"
                                {...field}
                                readOnly
                                className="bg-gray-50 cursor-not-allowed"
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Auto-populated from PIN code
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="NY"
                                {...field}
                                readOnly
                                className="bg-gray-50 cursor-not-allowed"
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Auto-populated from PIN code
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Order Notes (Optional)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Special instructions for delivery"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Hidden field for email when using saved address */}
                {addresses.length > 0 && !showAddressForm && (
                  <div style={{ display: "none" }}>
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input type="email" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Payment section - always visible */}
                <div className="payment-section pt-4 border-t">
                  <h3 className="font-medium text-base mb-4">Payment Method</h3>

                  <FormField
                    control={form.control}
                    name="paymentMethod"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>Select Payment Option</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-col space-y-3"
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="cod" id="cod" />
                              <Label htmlFor="cod">
                                Cash on Delivery (COD)
                              </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="razorpay" id="razorpay" />
                              <Label htmlFor="razorpay">
                                Pay Online with Razorpay
                              </Label>
                            </div>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {form.watch("paymentMethod") === "razorpay" ? (
                    <div className="border-t pt-4 mt-4">
                      <RazorpayPayment
                        amount={finalOrderTotal * 100} // Convert to paise
                        shippingDetails={{
                          name: form.getValues("name") || "",
                          address: form.getValues("address") || "",
                          city: form.getValues("city") || "",
                          state: form.getValues("state") || "",
                          zipCode: form.getValues("zipCode") || "",
                          phone: form.getValues("phone") || "",
                        }}
                        onSuccess={(orderId) => {
                          // Redirect to order confirmation page
                          setLocation(
                            `/order-confirmation/${orderId}?success=true&total=${finalOrderTotal}`
                          );
                        }}
                        onError={(error) => {
                          toast({
                            title: "Payment Failed",
                            description:
                              error ||
                              "There was an error processing your payment. Please try again.",
                            variant: "destructive",
                          });
                        }}
                      />
                    </div>
                  ) : (
                    <div className="pt-4 mt-4">
                      <Button
                        type="button"
                        className="w-full bg-primary text-white"
                        disabled={processingOrder}
                        onClick={(e) => {
                          e.preventDefault(); // Prevent default form submission

                          console.log("Place Order button clicked");

                          // Direct call to onSubmit for saved addresses
                          if (
                            addresses.length > 0 &&
                            selectedAddressId &&
                            !showAddressForm
                          ) {
                            console.log(
                              "Place Order button: processing saved address",
                              selectedAddressId
                            );

                            // Find the selected address
                            const selectedAddress = addresses.find(
                              (a) => a.id.toString() === selectedAddressId
                            );

                            if (selectedAddress) {
                              console.log(
                                "Selected address found:",
                                selectedAddress
                              );
                              // Create a direct submission object with values from the selected address
                              const submissionValues = {
                                name: selectedAddress.fullName,
                                email: user?.email ?? user?.username ?? "",
                                phone: selectedAddress.phone,
                                address: selectedAddress.address,
                                city: selectedAddress.city,
                                state: selectedAddress.state,
                                zipCode: selectedAddress.pincode,
                                paymentMethod:
                                  form.getValues("paymentMethod") || "cod",
                                notes: form.getValues("notes") || "",
                              };

                              console.log(
                                "Directly submitting with values:",
                                submissionValues
                              );
                              // Call onSubmit directly with the values
                              onSubmit(submissionValues);
                            }
                          } else {
                            // For new address form, submit via form handler
                            console.log(
                              "Processing new address form submission"
                            );
                            form.handleSubmit(onSubmit)();
                          }
                        }}
                      >
                        {processingOrder ? "Processing..." : "Place Order"}
                      </Button>
                    </div>
                  )}
                </div>
              </form>
            </Form>
          </div>
        </div>

        {/* Order Summary */}
        <div className="w-full md:w-1/3">
          <div className="bg-white/90 rounded-2xl shadow-xl p-2 sm:p-6 md:sticky md:top-4">
            <h2 className="text-lg font-semibold mb-6 text-center sm:text-left text-black">
              Order Summary
            </h2>

            <div className="mb-4 flex flex-col md:flex-row md:items-center gap-2">
              <Input
                type="text"
                placeholder="Enter coupon code"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                className="w-full md:w-64 bg-white"
                disabled={!!appliedCoupon}
              />
              <Button
                type="button"
                onClick={handleApplyCoupon}
                disabled={couponLoading || !!appliedCoupon}
                className="w-full md:w-auto"
              >
                {appliedCoupon
                  ? "Applied"
                  : couponLoading
                    ? "Applying..."
                    : "Apply"}
              </Button>
            </div>
            {couponError && (
              <Alert variant="destructive" className="mb-2">
                {couponError}
              </Alert>
            )}
            {appliedCoupon && (
              <Alert
                variant="default"
                className="mb-2 flex items-center justify-between"
              >
                <span>
                  Coupon <b>{appliedCoupon.code}</b> applied!{" "}
                  {appliedCoupon.discountPercentage}% off
                </span>
                <button
                  type="button"
                  className="ml-2 text-red-500 hover:text-red-700 font-bold text-lg"
                  onClick={handleRemoveCoupon}
                  aria-label="Remove coupon"
                >
                  ×
                </button>
              </Alert>
            )}

            <div className="space-y-4 mb-4">
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="flex justify-between items-center border-b pb-2"
                >
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-md overflow-hidden mr-2 bg-gray-100 flex items-center justify-center">
                      <img
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          console.log(
                            "Image load error for:",
                            item.product.name
                          );
                          const target = e.target as HTMLImageElement;
                          target.src =
                            "https://via.placeholder.com/80?text=Product";
                        }}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{item.product.name}</p>
                      <p className="text-xs text-gray-500">
                        Qty: {item.quantity}
                      </p>
                    </div>
                  </div>
                  <p className="font-medium">
                    ₹{(item.product.price * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>

            {/* Calculate subtotal and delivery charges */}
            <div className="flex justify-between mb-2">
              <span className="text-gray-600">Subtotal</span>
              <span className="font-medium">₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-gray-600">Delivery Charges</span>
              {deliveryCharges > 0 ? (
                <span className="font-medium text-blue-600">
                  ₹{deliveryCharges.toFixed(2)}
                </span>
              ) : (
                <span className="font-medium text-green-600">Free</span>
              )}
            </div>

            {/* Wallet integration */}
            {!isWalletLoading && wallet && settings?.isActive && (
              <div className="my-4 border rounded-md p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="use-wallet"
                      checked={useWalletCoins}
                      onCheckedChange={(checked) =>
                        setUseWalletCoins(checked === true)
                      }
                      disabled={!wallet.balance || wallet.balance <= 0}
                    />
                    <label
                      htmlFor="use-wallet"
                      className="text-sm font-medium flex items-center cursor-pointer"
                    >
                      <Coins className="h-4 w-4 mr-1 text-primary" />
                      Use Wallet Balance ({wallet.balance} wallet rupees)
                    </label>
                  </div>
                  {maxWalletPoints > 0 && (
                    <span className="text-xs text-green-600 font-medium">
                      Up to ₹{maxWalletPoints} wallet rupees
                    </span>
                  )}
                </div>

                {useWalletCoins && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      min={0}
                      max={maxWalletPoints}
                      value={walletPointsInput}
                      onChange={(e) => {
                        const val = Math.max(
                          0,
                          Math.min(maxWalletPoints, Number(e.target.value))
                        );
                        setWalletPointsInput(val);
                      }}
                      className="border rounded px-2 py-1 w-24"
                      placeholder={`Max ₹${maxWalletPoints}`}
                    />
                    <span className="text-xs text-gray-500">
                      Enter wallet rupees to use
                    </span>
                  </div>
                )}
                {walletError && (
                  <div className="text-xs text-red-500 mt-1">{walletError}</div>
                )}
                {wallet.balance <= 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    No wallet rupees available in your wallet
                  </div>
                )}
              </div>
            )}

            {/* Redeem Coins Section */}
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <span className="font-medium">Redeemed Coins Left:</span>
                <span className="text-yellow-600 font-bold">
                  {wallet
                    ? wallet.redeemedBalance -
                      (useRedeemedCoins ? redeemAmount : 0)
                    : 0}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span>Max you can use for this order:</span>
                <span className="font-bold">{maxRedeemableFromRedeemed}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  min={0}
                  max={maxRedeemableFromRedeemed}
                  value={redeemAmount}
                  onChange={(e) => {
                    const val = Math.max(
                      0,
                      Math.min(
                        maxRedeemableFromRedeemed,
                        Number(e.target.value)
                      )
                    );
                    setRedeemAmount(val);
                  }}
                  className="border rounded px-2 py-1 w-24"
                  placeholder={`Max ₹${maxRedeemableFromRedeemed}`}
                />
                <button
                  type="button"
                  className="bg-yellow-500 text-white px-3 py-1 rounded disabled:opacity-50"
                  disabled={
                    redeemAmount <= 0 ||
                    redeemAmount > maxRedeemableFromRedeemed
                  }
                  onClick={() => setUseRedeemedCoins(true)}
                >
                  Apply Redeem
                </button>
              </div>
              {redeemAmount > maxRedeemableFromRedeemed && (
                <div className="text-red-500 text-xs mt-1">
                  You can only redeem up to ₹{maxRedeemableFromRedeemed} wallet
                  rupees for this order.
                </div>
              )}
            </div>

            {/* Show wallet discount only once, if applied */}
            {useWalletCoins && walletDiscount > 0 && (
              <div className="flex justify-between mb-2">
                <span className="text-gray-600">Wallet Discount</span>
                <span className="font-medium text-green-600">
                  -₹{walletDiscount.toFixed(2)}
                </span>
              </div>
            )}
            {/* Show redeem discount if applied */}
            {useRedeemedCoins && redeemAmount > 0 && (
              <div className="flex justify-between mb-2">
                <span className="text-gray-600">Redeem Discount</span>
                <span className="font-medium text-yellow-600">
                  -₹{redeemAmount.toFixed(2)}
                </span>
              </div>
            )}
            {/* Show coupon discount if applied */}
            {appliedCoupon && (
              <div className="flex justify-between mb-2">
                <span className="text-gray-600">Coupon Discount</span>
                <span className="font-medium text-green-600">
                  -₹{couponDiscountAmount}
                </span>
              </div>
            )}
            {/* Show original total with strikethrough and discounted total in green if any discount is applied */}
            {walletDiscount > 0 ||
            redeemAmount > 0 ||
            couponDiscountAmount > 0 ? (
              <div className="flex flex-col mb-6">
                <div className="flex justify-between mb-1">
                  <span className="text-lg font-semibold">Total</span>
                  <span className="text-lg font-semibold line-through text-gray-400">
                    ₹{(subtotal + deliveryCharges).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-lg font-semibold text-green-700">
                    Discounted Total
                  </span>
                  <span className="text-lg font-semibold text-green-700">
                    ₹{finalOrderTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex justify-between mb-6">
                <span className="text-lg font-semibold">Total</span>
                <span className="text-lg font-semibold">
                  ₹{finalOrderTotal.toFixed(2)}
                </span>
              </div>
            )}

            <div className="bg-gray-50 p-4 rounded-md">
              <h3 className="font-medium text-sm mb-2">Payment Method</h3>
              <p className="text-sm text-gray-600">
                {form.watch("paymentMethod") === "razorpay"
                  ? "Pay Online with Razorpay"
                  : "Cash on Delivery (COD)"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Show voucher info if available */}
      {voucher && (
        <Alert variant="default">
          <AlertTitle>Wallet Voucher Auto-Applied!</AlertTitle>
          <AlertDescription>
            Voucher Code: <b>{voucher.code}</b>
            <br />
            Discount: ₹{voucher.value}
            <br />
            <span>
              Your wallet voucher has been auto-applied to this order.
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-8 right-8 z-50 bg-primary text-white rounded-full shadow-lg p-3 hover:bg-primary/90 transition-colors flex items-center justify-center"
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}
