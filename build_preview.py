# Assembles dist/main.js + dist/main.css into one self-contained page for the shareable preview.
js = open('dist/main.js', encoding='utf-8').read().replace('</script', '<\\/script')
css = open('dist/main.css', encoding='utf-8').read()
html = f'''<title>Laker Fantasy Bball</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{css}</style>
<div id="root"></div>
<script>{js}</script>
'''
open('dist/preview.html', 'w', encoding='utf-8').write(html)
print(len(html), 'bytes')
