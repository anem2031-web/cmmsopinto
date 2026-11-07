"""Keep every delegate PDF page, adding only a financial block in free space or a new A4 page."""
import argparse
import logging
from pathlib import Path
from pypdf import PdfReader, PdfWriter, Transformation
import pdfplumber

logging.getLogger("pdfminer").setLevel(logging.ERROR)
parser = argparse.ArgumentParser()
parser.add_argument("--base", required=True)
parser.add_argument("--finance", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
base, finance = PdfReader(args.base), PdfReader(args.finance)
if not base.pages or len(finance.pages) != 1:
    raise ValueError("Unexpected input page count")
writer = PdfWriter()
writer.clone_document_from_reader(base)
target = writer.pages[-1]
width, height = float(target.mediabox.width), float(target.mediabox.height)
footer = finance.pages[0]
scale = width / float(footer.mediabox.width)
footer_height = float(footer.mediabox.height) * scale
if footer_height > height - 28:
    raise ValueError("Financial block exceeds one A4 page")
with pdfplumber.open(args.base) as doc:
    page = doc.pages[-1]
    bottom = max([20] + [float(c["bottom"]) for c in page.chars]
                 + [float(im["bottom"]) for im in page.images])
top = bottom + 12
if top + footer_height > height - 14:
    target = writer.add_blank_page(width, height)
    top = 14
target.merge_transformed_page(footer, Transformation().scale(scale).translate(0, height - top - footer_height))
writer.add_metadata({"/Subject": "Legacy DPB financial copy; lowest recorded custody; original delegate pages retained"})
with Path(args.output).open("wb") as stream:
    writer.write(stream)
