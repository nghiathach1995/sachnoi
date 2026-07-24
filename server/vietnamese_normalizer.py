import re

try:
    from num2words import num2words
    HAS_NUM2WORDS = True
except ImportError:
    HAS_NUM2WORDS = False

def _replace_number(match):
    num_str = match.group(0)
    # Loại bỏ dấu chấm ngăn cách hàng nghìn, đổi phẩy thành chấm thập phân
    clean_str = num_str.replace('.', '').replace(',', '.')
    
    if not HAS_NUM2WORDS:
        return num_str

    try:
        if '.' in clean_str:
            num = float(clean_str)
        else:
            num = int(clean_str)
        
        words = num2words(num, lang='vi')
        # Sửa "point" thành "phẩy" do đôi khi num2words dùng từ tiếng Anh cho dấu phẩy
        words = words.replace(' point ', ' phẩy ')
        return words
    except Exception:
        return num_str

def normalize_vietnamese_text(text):
    if not text:
        return text

    # Mở rộng các ký hiệu thông dụng
    replacements = {
        '%': ' phần trăm',
        '$': ' đô la',
        '&': ' và ',
        '+': ' cộng ',
        '=': ' bằng ',
        ' VNĐ': ' Việt Nam đồng',
        ' vnđ': ' Việt Nam đồng',
        ' VND': ' Việt Nam đồng',
        ' USD': ' đô la Mỹ',
    }
    
    for symbol, word in replacements.items():
        text = text.replace(symbol, word)

    # Dùng regex để tìm các số (vd: 1.000.000, 15,5, 123)
    # Match chữ số, tùy chọn theo sau là chấm hoặc phẩy và chữ số khác
    number_pattern = re.compile(r'\b\d+(?:[\.,]\d+)*\b')
    text = number_pattern.sub(_replace_number, text)
    
    # Chuẩn hóa khoảng trắng thừa
    text = re.sub(r'\s+', ' ', text).strip()
    return text
