import * as pdfjsLib from 'pdfjs-dist';
import ePub from 'epubjs';
import mammoth from 'mammoth';

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
      // Yield to main thread every 5 pages to prevent UI freezing
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
      
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
            pageText += '\n';
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
        
        const extractTextFromNode = (node) => {
          if (node.nodeType === 3) return node.textContent; // TEXT_NODE
          if (node.nodeType !== 1) return ''; // ELEMENT_NODE

          let text = '';
          for (let i = 0; i < node.childNodes.length; i++) {
            text += extractTextFromNode(node.childNodes[i]);
          }

          const tagName = node.tagName ? node.tagName.toUpperCase() : '';
          const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'ARTICLE', 'SECTION', 'UL', 'OL'];
          
          if (blockTags.includes(tagName)) {
            text += '\n\n';
          } else if (tagName === 'BR') {
            text += '\n';
          }
          
          return text;
        };

        for (let i = 0; i < spine.length; i++) {
          if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
          
          const item = spine.get(i);
          const doc = await item.load(book.load.bind(book));
          if (doc && doc.body) {
            fullText += extractTextFromNode(doc.body) + '\n\n';
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

export const parseDocx = async (file) => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (error) {
    console.error('Error parsing DOCX:', error);
    throw error;
  }
};

export const filterBookContent = (text) => {
  // 1. Remove Table of Contents (lines with many dots)
  let lines = text.split('\n');
  lines = lines.filter(line => !line.match(/\.{5,}/));
  text = lines.join('\n');
  
  // 1.2 Bỏ qua Tài liệu tham khảo (References) ở cuối sách
  const removeReferences = (content) => {
    let lines = content.split('\n');
    const refRegex = /^(tài liệu tham khảo|thư mục tham khảo|references?|bibliography)[\s.:-]*$/i;
    for (let i = lines.length - 1; i >= Math.floor(lines.length * 0.5); i--) {
      if (refRegex.test(lines[i].trim())) {
        return lines.slice(0, i).join('\n');
      }
    }
    return content;
  };
  text = removeReferences(text);

  // 1.3 Bỏ qua Mục lục (TOC block)
  const removeTOCBlock = (content) => {
    let lines = content.split('\n');
    const tocStart = /^(mục lục|table of contents?|contents)[\s.:-]*$/i;
    const actualContentStart = /^(lời tựa|lời nói đầu|lời mở đầu|giới thiệu|chương\s*1|phần\s*1|mở đầu)/i;
    
    let tocIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 300); i++) {
      if (tocStart.test(lines[i].trim())) {
        tocIdx = i;
        break;
      }
    }
    
    if (tocIdx !== -1) {
      let contentIdx = -1;
      for (let i = tocIdx + 1; i < lines.length; i++) {
        let lineTrimmed = lines[i].trim();
        // Thoát khỏi mục lục nếu gặp keyword bắt đầu nội dung HOẶC gặp 1 đoạn văn rất dài (>200 ký tự)
        if (actualContentStart.test(lineTrimmed) && lineTrimmed.length < 100) {
          contentIdx = i;
          break;
        }
        if (lineTrimmed.length > 200) {
          contentIdx = i;
          break;
        }
      }
      
      if (contentIdx !== -1) {
        lines.splice(tocIdx, contentIdx - tocIdx);
        return lines.join('\n');
      }
    }
    
    // Nếu mục lục nằm ở cuối sách
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 300); i--) {
      if (tocStart.test(lines[i].trim())) {
        return lines.slice(0, i).join('\n');
      }
    }
    return content;
  };
  text = removeTOCBlock(text);
  
  // 1.5 Nối các dòng bị xuống dòng giữa chừng (line wraps)
  // Nếu 1 dòng không kết thúc bằng dấu câu kết thúc (. ! ?) và dòng tiếp theo bắt đầu bằng chữ thường, nối chúng lại bằng khoảng trắng
  const lowercaseRegex = /[a-zàáâãèéêìíòóôõùúăđĩũơưạảấầẩẫậắằẳẵặẹẻẽềềểễệịỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/;
  const sentenceEndRegex = /[.!?]/;
  
  let newLines = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (i < lines.length - 1 && line.trim() !== '' && lines[i+1].trim() !== '') {
      let nextLine = lines[i+1].trim();
      let lastChar = line.trim().slice(-1);
      let firstChar = nextLine.charAt(0);
      
      if (!sentenceEndRegex.test(lastChar) && lowercaseRegex.test(firstChar)) {
        // Nối dòng tiếp theo vào dòng hiện tại
        lines[i+1] = line + ' ' + lines[i+1].trimLeft();
        continue; // Bỏ qua dòng hiện tại, không push vào newLines (vì nó đã được cộng dồn vào lines[i+1])
      }
    }
    newLines.push(line);
  }
  text = newLines.join('\n');
  
  // 2. Normalize punctuation spacing
  // Remove space before punctuation: "anh ,em" -> "anh, em"
  text = text.replace(/\s+([,.:;!?])/g, '$1');
  // Ensure space after punctuation (except if it's followed by digit/quote)
  text = text.replace(/([,.:;!?])([^\s\d"'\)\]}])/g, '$1 $2');
  
  // 3. Fix multiple spaces
  text = text.replace(/ {2,}/g, ' ');
  
  // 4. Vietnamese Abbreviations
  const abbrevMap = {
    'UBND': 'Ủy ban nhân dân',
    'HĐND': 'Hội đồng nhân dân',
    'TP': 'Thành phố',
    'HCM': 'Hồ Chí Minh',
    'HN': 'Hà Nội',
    'TW': 'Trung ương',
    'BĐS': 'Bất động sản',
    'TTg': 'Thủ tướng',
    'NĐ-CP': 'Nghị định Chính phủ'
  };
  
  for (const [key, value] of Object.entries(abbrevMap)) {
    const regex = new RegExp(`\\b${key}\\b`, 'g');
    text = text.replace(regex, value);
  }
  
  // 5. Bỏ qua các phần thừa ở đầu sách (chỉ giữ Tên sách, Tác giả và nhảy đến nội dung chính)
  const skipFrontMatter = (content) => {
    let lines = content.split('\n');
    let firstLines = [];
    
    // Lấy 2 dòng đầu tiên có nội dung (Tên sách & Tác giả)
    let i = 0;
    while(firstLines.length < 2 && i < lines.length) {
      if (lines[i].trim().length > 0) {
        firstLines.push(lines[i].trim());
      }
      i++;
    }
    
    // Tìm các từ khóa bắt đầu nội dung
    const startKeywords = /^(lời tựa|lời nói đầu|lời mở đầu|giới thiệu|chương\s*1|phần\s*1|mở đầu)/i;
    let startIndex = i;
    let foundStart = false;
    
    for (let j = i; j < lines.length; j++) {
      if (startKeywords.test(lines[j].trim())) {
        startIndex = j;
        foundStart = true;
        break;
      }
    }
    
    // Nếu tìm thấy từ khóa, bỏ qua toàn bộ phần ở giữa
    if (foundStart) {
      return firstLines.join('\n\n') + '\n\n' + lines.slice(startIndex).join('\n');
    }
    return content; // Nếu không tìm thấy, giữ nguyên
  };
  
  text = skipFrontMatter(text);
  
  return text.trim();
};

export const parseFile = async (file) => {
  const fileType = file.name.split('.').pop().toLowerCase();
  
  let rawText = '';
  switch (fileType) {
    case 'txt':
      rawText = await parseTxt(file); break;
    case 'pdf':
      rawText = await parsePdf(file); break;
    case 'epub':
      rawText = await parseEpub(file); break;
    case 'docx':
      rawText = await parseDocx(file); break;
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
  
  return filterBookContent(rawText);
};
