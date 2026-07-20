import * as pdfjsLib from 'pdfjs-dist';
import ePub from 'epubjs';

// Setup pdf.js worker using Vite's URL import
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export const parseTxt = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
};

export const parsePdf = async (file) => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items;

      let pageText = '';
      let lastX = null;
      let lastY = null;
      let lastWidth = 0;
      let lastFontSize = 12;
      let lastFontSizeCharCount = 0;

      for (let j = 0; j < items.length; j++) {
        const item = items[j];

        // Some items are just markers, skip them
        if (!item.str && !item.hasEOL) continue;

        const [, , , , x, y] = item.transform; // [scaleX, skewX, skewY, scaleY, translateX, translateY]
        const fontSize = Math.abs(item.transform[3]) || lastFontSize;

        let isDropCap = false;
        if (Math.abs(fontSize - lastFontSize) > 0.5) {
          // Nếu font size giảm mạnh (chữ trước to hơn chữ này > 1.4 lần)
          // VÀ chữ trước rất ngắn (<= 4 ký tự) -> Đây là Drop Cap (chữ to đầu đoạn)
          if (lastFontSize > fontSize * 1.4 && lastFontSizeCharCount > 0 && lastFontSizeCharCount <= 4) {
            isDropCap = true;
          }
          lastFontSizeCharCount = item.str.trim().length;
        } else {
          lastFontSizeCharCount += item.str.trim().length;
        }

        if (isDropCap) {
          // Xóa các khoảng trắng/xuống dòng thừa do Drop Cap tạo ra
          pageText = pageText.replace(/\s+$/, '');
          // Nối trực tiếp vào phần còn lại của chữ (VD: "M" + "ỗi" -> "Mỗi")
          pageText += item.str;
        } else if (lastY === null) {
          // First item on the page
          pageText += item.str;
        } else {
          const yDiff = Math.abs(y - lastY);
          const isNewLine = yDiff > fontSize * 0.4;

          if (isNewLine) {
            // New line detected
            const isNewParagraph = yDiff > fontSize * 1.2;
            pageText += isNewParagraph ? '\n\n' : '\n';
            pageText += item.str;
          } else {
            // Same line — determine if we need a space
            const xGap = x - (lastX + lastWidth);
            const needSpace = xGap > fontSize * 0.2;
            pageText += (needSpace ? ' ' : '') + item.str;
          }
        }

        lastX = x;
        lastY = y;
        lastWidth = item.width || 0;
        lastFontSize = fontSize;

        // Handle explicit end-of-line markers from PDF.js
        if (item.hasEOL) {
          pageText += '\n';
          lastY = null; // reset so next item is treated as new line start
        }
      }

      let trimmedPageText = pageText.trim();
      
      // Bỏ qua số trang ở đầu và cuối trang (VD: "1", "- 2 -", "Trang 3")
      if (trimmedPageText.length > 0) {
        const pageNumRegex = /^(?:trang|page)?\s*-?\s*\d+\s*-?\s*$/i;
        let lines = trimmedPageText.split('\n');
        
        // Xóa dòng số trang ở đầu
        while (lines.length > 0 && (lines[0].trim() === '' || pageNumRegex.test(lines[0].trim()))) {
          lines.shift();
        }
        
        // Xóa dòng số trang ở cuối
        while (lines.length > 0 && (lines[lines.length - 1].trim() === '' || pageNumRegex.test(lines[lines.length - 1].trim()))) {
          lines.pop();
        }
        
        trimmedPageText = lines.join('\n').trim();
      }

      if (trimmedPageText.length > 0) {
        fullText += trimmedPageText + '\n\n';
      }
    }

    return fullText;
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw error;
  }
};

export const parseEpub = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const book = ePub(e.target.result);
        await book.ready;
        
        let fullText = '';
        // Extract text from each spine item
        const spine = book.spine;
        
        // This is a simplified extraction, for large EPUBs it might be better to extract on demand,
        // but for now we extract all text.
        for (let i = 0; i < spine.length; i++) {
          const item = spine.get(i);
          const doc = await item.load(book.load.bind(book));
          if (doc) {
            fullText += doc.body.textContent + '\n\n';
          }
          item.unload(); // Free up memory
        }
        
        resolve(fullText);
      } catch (error) {
        console.error("Error parsing EPUB:", error);
        reject(error);
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
  });
};

export const parseFile = async (file) => {
  const fileType = file.name.split('.').pop().toLowerCase();
  
  switch (fileType) {
    case 'txt':
      return await parseTxt(file);
    case 'pdf':
      return await parsePdf(file);
    case 'epub':
      return await parseEpub(file);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
};
