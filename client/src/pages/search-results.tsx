import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Card,
  CardContent
} from "@/components/ui/card";
import { ProductCard } from "@/components/ui/product-card";
import { useToast } from "@/hooks/use-toast";
import { Search, Filter, Loader2, Tag, Hash, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useDebounce } from "@/hooks/use-debounce";

// Define the search result type with relevance scoring info
interface SearchResult {
  id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  images?: string | string[];
  search_rank?: number;
  exact_match_rank?: number;
  createdAt?: string | Date;
  [key: string]: any; // Allow for other properties
}

export default function SearchResultsPage() {
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const { toast } = useToast();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
  const [products, setProducts] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("relevance");
  const [priceRange, setPriceRange] = useState("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  
  // Parse the URL query parameters
  useEffect(() => {
    // First try from window.location.search for direct navigation (form submission with href change)
    let params = new URLSearchParams(window.location.search);
    let query = params.get('q') || "";
    
    // If the query param wasn't found in window.location.search, check the URL path for /search/q=query format
    if (!query) {
      // Check if the URL matches the pattern /search/q=query or similar
      const match = window.location.pathname.match(/\/search\/q=(.+)$/);
      if (match && match[1]) {
        query = decodeURIComponent(match[1]);
      }
    }
    
    console.log("Search results page - query param:", query);
    console.log("Full URL:", window.location.href);
    console.log("Location path:", window.location.pathname);
    
    if (query) {
      setSearchQuery(query);
      // Split the query into terms for display - add safety checks for null/undefined
      if (query && typeof query === 'string') {
        // Keep the full search query intact as a single term for display and correct search behavior
        setSearchTerms([query.trim().toLowerCase()]);
      } else {
        setSearchTerms([]);
      }
      fetchSearchResults(query);
    } else {
      setLoading(false);
      setProducts([]);
    }
  }, [location]);
  
  // Function to fetch search results
  const fetchSearchResults = async (query: string) => {
    // Skip empty queries
    if (!query || query.trim() === '') {
      console.log("Skipping empty search query");
      setLoading(false);
      return;
    }
    
    console.log("SEARCH DEBUG - Starting fetch for query:", query);
    setLoading(true);
    try {
      // Use the FULL query string and ensure it's properly encoded
      const fullQuery = query.trim();
      console.log("SEARCH DEBUG - Using full search query:", fullQuery);
      
      // Add cache-busting parameter to ensure fresh results
      const cacheBuster = new Date().getTime();
      const searchUrl = `/api/lelekart-search?q=${encodeURIComponent(fullQuery)}&limit=50&_=${cacheBuster}`;
      console.log("SEARCH DEBUG - Final URL:", searchUrl);
      
      const response = await fetch(searchUrl, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      console.log("Search response status:", response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`Found ${data.length} search results`);
        
        // Extract unique categories from results
        const uniqueCategories = Array.from(new Set(data.map((p: SearchResult) => p.category).filter(Boolean)));
        setCategories(uniqueCategories);
        
        setProducts(data);
      } else {
        const errorText = await response.text();
        console.error("Search failed:", errorText);
        toast({
          title: "Search failed",
          description: "Unable to fetch search results. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error during search:", error);
      toast({
        title: "Search error",
        description: "An error occurred while fetching results.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };
  
  // Handle form submission
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery && searchQuery.trim()) {
      setLocation(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      // Keep the full search query as a single term for better matching
      setSearchTerms([searchQuery.trim().toLowerCase()]);
      fetchSearchResults(searchQuery.trim());
    }
  };
  
  // DISABLED: This was causing multiple competing search requests
  // We now handle search only through direct form submission or URL changes
  /*
  useEffect(() => {
    if (debouncedSearchQuery && debouncedSearchQuery.trim() && debouncedSearchQuery !== searchQuery) {
      setLocation(`/search?q=${encodeURIComponent(debouncedSearchQuery.trim())}`);
      // Keep the full search query as a single term for better matching
      setSearchTerms([debouncedSearchQuery.trim().toLowerCase()]);
      fetchSearchResults(debouncedSearchQuery.trim());
    }
  }, [debouncedSearchQuery]);
  */
  
  // Filter and sort products
  const getFilteredAndSortedProducts = () => {
    // First filter by category if any are selected
    let filteredProducts = [...products];
    
    if (selectedCategories.length > 0) {
      filteredProducts = filteredProducts.filter(p => 
        p.category && selectedCategories.includes(p.category)
      );
    }
    
    // Then filter by price range
    if (priceRange !== "all") {
      switch (priceRange) {
        case "under500":
          filteredProducts = filteredProducts.filter(p => p.price < 500);
          break;
        case "500to1000":
          filteredProducts = filteredProducts.filter(p => p.price >= 500 && p.price <= 1000);
          break;
        case "1000to5000":
          filteredProducts = filteredProducts.filter(p => p.price > 1000 && p.price <= 5000);
          break;
        case "over5000":
          filteredProducts = filteredProducts.filter(p => p.price > 5000);
          break;
      }
    }
    
    // Then sort by selected sort option
    switch (sortBy) {
      case "priceLowToHigh":
        return filteredProducts.sort((a, b) => a.price - b.price);
      case "priceHighToLow":
        return filteredProducts.sort((a, b) => b.price - a.price);
      case "newest":
        return filteredProducts.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });
      default:
        // For relevance, use the combined score from PostgreSQL if available
        return filteredProducts.sort((a, b) => {
          const scoreA = ((a.search_rank || 0) + (a.exact_match_rank || 0));
          const scoreB = ((b.search_rank || 0) + (b.exact_match_rank || 0));
          return scoreB - scoreA;
        });
    }
  };
  
  // Toggle category selection
  const toggleCategory = (category: string) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category) 
        : [...prev, category]
    );
  };
  
  const filteredAndSortedProducts = getFilteredAndSortedProducts();
  
  // Function to strip HTML tags from text
  const stripHtmlTags = (html: string) => {
    if (!html) return "";
    try {
      // Create a temporary DOM element
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      // Get the text content
      return tempDiv.textContent || tempDiv.innerText || "";
    } catch (error) {
      console.error("Error stripping HTML tags:", error);
      // Fallback to regex-based removal
      return html.replace(/<\/?[^>]+(>|$)/g, '');
    }
  };

  // Highlight search terms in a string
  const highlightSearchTerms = (text: string) => {
    if (!text) return "";
    if (!searchTerms || searchTerms.length === 0) return text;
    
    try {
      // First strip any HTML tags
      const cleanText = stripHtmlTags(text);
      
      // Create a regex pattern from search terms with error handling
      const pattern = searchTerms
        .filter(term => term && typeof term === 'string') // Ensure valid terms
        .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      
      if (!pattern) return cleanText;
      
      const regex = new RegExp(`(${pattern})`, 'gi');
      
      // Split by regex matches
      const parts = cleanText.split(regex);
      
      return parts.map((part, i) => {
        // Check if this part matches any search term (case insensitive)
        const isMatch = searchTerms.some(term => 
          part.toLowerCase() === term.toLowerCase()
        );
        
        return isMatch 
          ? <mark key={i} className="bg-yellow-200 px-0.5 rounded">{part}</mark>
          : part;
      });
    } catch (error) {
      // If any errors occur during highlighting, return the original text without HTML
      console.error("Error highlighting search terms:", error);
      return stripHtmlTags(text);
    }
  };
  
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              type="text"
              placeholder="Searc for products, brands and more"
              className="pl-10 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Search info and term badges */}
          <div className="mb-4">
            <h1 className="text-2xl font-bold">
              {filteredAndSortedProducts.length > 0 
                ? `${filteredAndSortedProducts.length} results for "${searchQuery || ''}"` 
                : `No results found for "${searchQuery || ''}"`}
            </h1>
            
            {searchTerms.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                <div className="text-sm text-gray-500 flex items-center">
                  <Hash className="h-4 w-4 mr-1" />
                  Search terms:
                </div>
                {searchTerms.map((term, index) => (
                  <Badge key={index} variant="outline">
                    {term}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Left sidebar with filters */}
            <div className="md:col-span-1">
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-medium text-lg mb-4 flex items-center">
                    <Filter className="h-4 w-4 mr-2" />
                    Filters
                  </h3>
                  
                  {/* Price Range Filter */}
                  <div className="mb-6">
                    <h4 className="font-medium mb-2">Price Range</h4>
                    <Select value={priceRange} onValueChange={setPriceRange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Price Range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Prices</SelectItem>
                        <SelectItem value="under500">Under ₹500</SelectItem>
                        <SelectItem value="500to1000">₹500 - ₹1,000</SelectItem>
                        <SelectItem value="1000to5000">₹1,000 - ₹5,000</SelectItem>
                        <SelectItem value="over5000">Over ₹5,000</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* Category Filter */}
                  {categories.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2 flex items-center">
                        <Tag className="h-4 w-4 mr-1" />
                        Categories
                      </h4>
                      <div className="space-y-2">
                        {categories.map(category => (
                          <div key={category} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`category-${category}`} 
                              checked={selectedCategories.includes(category)}
                              onCheckedChange={() => toggleCategory(category)}
                            />
                            <label 
                              htmlFor={`category-${category}`}
                              className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {category}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            
            {/* Main content area */}
            <div className="md:col-span-3">
              {/* Sorting options */}
              <div className="mb-6 flex justify-between items-center">
                <div className="flex items-center">
                  <Sparkles className="h-4 w-4 mr-2 text-primary" />
                  <span className="text-sm font-medium">Sort by:</span>
                </div>
                
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relevance">Relevance</SelectItem>
                    <SelectItem value="priceLowToHigh">Price: Low to High</SelectItem>
                    <SelectItem value="priceHighToLow">Price: High to Low</SelectItem>
                    <SelectItem value="newest">Newest First</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Results display */}
              {filteredAndSortedProducts.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredAndSortedProducts.map(product => (
                    <div key={product.id} className="flex flex-col">
                      <ProductCard 
                        product={product}
                        featured={false}
                      />
                      {/* Add highlighted product description snippet */}
                      {product.description && (
                        <div className="mt-1 text-xs text-gray-500 line-clamp-2">
                          {highlightSearchTerms(product.description)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-10 text-center">
                    <div className="mb-4">
                      <Search className="h-12 w-12 mx-auto text-gray-400" />
                    </div>
                    <h2 className="text-xl font-medium mb-2">No products found</h2>
                    <p className="text-gray-500 mb-6">
                      We couldn't find any products matching "{searchQuery || ''}".
                    </p>
                    <div className="space-y-2">
                      <p className="text-sm text-gray-500">Try:</p>
                      <ul className="text-sm text-gray-500 list-disc pl-4 inline-block text-left">
                        <li>Checking your spelling</li>
                        <li>Using more general terms</li>
                        <li>Using fewer keywords</li>
                        <li>Removing any filters</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}