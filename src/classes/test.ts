// const processNextFile = async () => {
//   if (activeProcessors.size >= MAX_CONCURRENT_FILES || pdfQueue.length === 0)
//     return;

//   const nextFile = pdfQueue.shift()!; // Get the next file from the queue
//   const processor = new PDFProcessor({
//     maxConcurrent: 2,
//     pageBufferSize: PAGE_BUFFER_SIZE,
//   });
//   activeProcessors.set(nextFile.name, processor);

//   try {
//     // Initialize the processor with the file
//     await processor.processFile(nextFile);

//     // Set initial visible pages (e.g., first 3 pages)
//     const totalPages = processor.totalPages; // Assume this is provided by PDFProcessor
//     const initialPages = Array.from(
//       { length: Math.min(3, totalPages) },
//       (_, i) => i + 1
//     );
//     setVisiblePages(initialPages); // Update state with visible pages
//     await Promise.all(
//       initialPages.map((pageNum) => processor.getPage(pageNum))
//     );

//     // Handle scroll-based visibility with debouncing
//     const handleScroll = debounce((entries: IntersectionObserverEntry[]) => {
//       entries.forEach((entry) => {
//         if (entry.isIntersecting) {
//           const pageNum = parseInt(
//             entry.target.getAttribute("data-page") || "0"
//           );
//           if (!visiblePages.includes(pageNum)) {
//             setVisiblePages((prev) => [...prev, pageNum]);
//           }
//         }
//       });
//     }, 100); // Debounce scroll events by 100ms

//     // Process newly visible pages
//     useEffect(() => {
//       if (!processor) return;
//       visiblePages.forEach(async (pageNum) => {
//         try {
//           const url = await processor.getPage(pageNum); // Assume getPage returns a URL
//           fileProcessingEmitter.emit(
//             "pageProcessed",
//             nextFile.name,
//             pageNum,
//             url
//           );
//         } catch (error) {
//           console.error(`Failed to load page ${pageNum}:`, error);
//           fileProcessingEmitter.emit("fileFailed", nextFile.name);
//         }
//       });
//     }, [processor, visiblePages]);

//     // Check if all pages are processed
//     if (processor.processedPages === totalPages) {
//       // Assume processedPages is tracked
//       fileProcessingEmitter.emit("fileCompleted", nextFile.name);
//       activeProcessors.delete(nextFile.name);
//       processor.cleanup(); // Free up resources
//       processNextFile(); // Process the next file
//     }
//   } catch (error) {
//     console.error(`Error processing file ${nextFile.name}:`, error);
//     fileProcessingEmitter.emit("fileFailed", nextFile.name);
//     activeProcessors.delete(nextFile.name);
//     processor.cleanup();
//     processNextFile();
//   }
// };
