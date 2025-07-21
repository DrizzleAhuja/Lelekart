import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Search,
  Menu,
  X,
  ShoppingCart,
  User,
  LogOut,
  ChevronDown,
  Mic,
  Home as HomeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SimpleSearch } from "@/components/ui/simple-search";
import { VoiceSearchDialog } from "@/components/search/voice-search-dialog";
import { AISearchService } from "@/services/ai-search-service";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/context/cart-context";

export function SimpleHeader() {
  const queryClient = useQueryClient();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [location, setLocation] = useLocation();

  // Use cart context for both guest and logged-in users
  const { cartItems } = useCart();

  // Use React Query to fetch user data
  const { data: user } = useQuery({
    queryKey: ["/api/user"],
    queryFn: async () => {
      const res = await fetch("/api/user", {
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) return null;
        throw new Error("Failed to fetch user");
      }

      return res.json();
    },
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
    refetchOnMount: false, // Prevent refetch on mount
    placeholderData: () => queryClient.getQueryData(["/api/user"]) || null, // Use cached user data instantly
  });

  // Get cart item count for notification badge (from context)
  const cartItemCount = cartItems.reduce(
    (sum, item) => sum + (item.quantity || 0),
    0
  );

  // Handle logout
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      queryClient.setQueryData(["/api/user"], null);
      queryClient.setQueryData(["/api/cart"], []);
      setLocation("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Implement search functionality
    console.log("Search for:", searchQuery);
  };

  const navigateTo = (path: string) => {
    setLocation(path);
    setMobileMenuOpen(false);
  };

  const handleCartClick = () => {
    setLocation("/cart");
  };

  const getDashboardLink = () => {
    if (!user) return "/";
    if (user.role === "admin") return "/admin";
    if (user.role === "seller") return "/seller/dashboard";
    return "/buyer/dashboard";
  };

  return (
    <header className="bg-gradient-to-r from-[#f5e7d4] via-[#fff8f1] to-[#f5e7d4] text-black sticky top-0 left-0 right-0 z-50 shadow-xl border-b border-cream font-sans m-0 p-0 backdrop-blur-md">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        {/* Logo Area */}
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-3xl font-extrabold tracking-tight text-primary drop-shadow-lg group-hover:scale-105 transition-transform duration-200" style={{textShadow: '0 2px 8px #ffe7b8'}}>Lelekart</span>
        </Link>
        {/* Navigation Links */}
        <nav className="flex gap-6 items-center justify-center py-2 mr-2 ml-9">
          <a href="/about-us" className="font-semibold text-gray-800 hover:text-primary transition-colors">About</a>
          <a href="/contact" className="font-semibold text-gray-800 hover:text-primary transition-colors">Contact</a>
          <a href="/faq" className="font-semibold text-gray-800 hover:text-primary transition-colors">FAQ</a>
        </nav>
        {/* Search Bar */}
        <div className="flex-1 flex justify-center mx-2">
          <div className="w-full max-w-lg">
            <div className="bg-cream rounded-full shadow-md flex items-center border border-cream focus-within:ring-2 focus-within:ring-primary/30 transition-all">
              <SimpleSearch className="w-full text-black placeholder:text-gray-500 px-4 py-2 rounded-full bg-transparent" variant="default" />
            </div>
          </div>
        </div>
        {/* User & Cart Area */}
        <div className="flex items-center gap-4">
          {!user ? (
            <a href="/auth" className="flex items-center py-2 px-5 bg-primary text-white font-semibold rounded-full shadow hover:bg-primary/90 transition">
              <User className="mr-2 h-5 w-5" />
              <span>Login</span>
            </a>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center py-2 px-5 bg-gray-100 text-primary font-semibold rounded-full shadow hover:bg-gray-200 transition">
                  <span>{user.name || user.username}</span>
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem asChild>
                  <Link href={getDashboardLink()} className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" /> 
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                  <span className="mr-2">🚪</span> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            onClick={handleCartClick}
            className="relative p-2 rounded-full bg-primary/10 hover:bg-primary/20 transition shadow-lg border-2 border-primary"
            title="Shopping Cart"
          >
            <ShoppingCart className="h-7 w-7 text-primary" />
            {cartItemCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center border-2 border-white shadow">
                {cartItemCount}
              </span>
            )}
          </button>
        </div>
        {/* Hamburger for mobile */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden ml-4 p-2 rounded-full bg-primary/10 hover:bg-primary/20 transition shadow"
          title="Open menu"
        >
          <Menu size={28} />
        </button>
      </div>
      {/* Mobile Menu Slide-in */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-40 flex">
          <div className="bg-white h-full w-4/5 max-w-xs p-6 shadow-2xl animate-slide-in-left flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <span className="text-2xl font-extrabold text-primary">Menu</span>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1 rounded-full hover:bg-primary/10" title="Close menu">
                <X size={28} />
              </button>
            </div>
            <nav className="flex flex-col gap-4">
              <Link href="/about-us" className="text-lg font-semibold py-2 px-3 rounded hover:bg-primary/10 hover:text-primary transition">About</Link>
              <Link href="/contact" className="text-lg font-semibold py-2 px-3 rounded hover:bg-primary/10 hover:text-primary transition">Contact</Link>
              <Link href="/faq" className="text-lg font-semibold py-2 px-3 rounded hover:bg-primary/10 hover:text-primary transition">FAQ</Link>
              {!user ? (
                <button onClick={() => navigateTo("/auth")}
                  className="w-full text-left py-2 px-3 rounded bg-primary text-white font-semibold mt-4">Login</button>
              ) : (
                <>
                  <button onClick={() => navigateTo(getDashboardLink())}
                    className="w-full text-left py-2 px-3 rounded bg-gray-100 text-primary font-semibold mt-4">Dashboard</button>
                  <button onClick={handleLogout}
                    className="w-full text-left py-2 px-3 rounded bg-red-100 text-red-700 font-semibold mt-2">Logout</button>
                </>
              )}
              <button onClick={handleCartClick}
                className="w-full text-left py-2 px-3 rounded bg-yellow-100 text-yellow-800 font-semibold mt-2">Cart {cartItemCount > 0 && `(${cartItemCount})`}</button>
            </nav>
          </div>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}
    </header>
  );
}
