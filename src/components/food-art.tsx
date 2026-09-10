import { useId } from "react";
import type { Recipe } from "@/lib/types";

export function FoodArt({ recipe, compact = false }: { recipe?: Recipe; compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  const ids = recipe?.ingredients.map((item) => item.ingredientId) ?? ["chicken", "rice", "zucchini", "greek-yogurt"];
  const sweet = recipe?.family === "pancakes" || recipe?.family === "dessert";
  const green = ids.some((item) => /zucchini|broccoli|spinach|salad|cucumber/.test(item));
  const grain = ids.some((item) => /rice|oat|pasta|quinoa|couscous/.test(item));
  const protein = ids.some((item) => /chicken|turkey|tofu|tuna|egg|chickpea|lentil|lean-beef/.test(item));
  const beef = ids.includes("lean-beef");
  const red = ids.some((item) => /tomato|strawberr|berr|pepper/.test(item));
  const creamy = ids.some((item) => /yogurt|skyr|mozzarella/.test(item));
  return (
    <svg viewBox="0 0 600 530" className={`food-art ${compact ? "food-art-compact" : ""}`} role="img"
      aria-label={recipe ? `Illustrazione editoriale indicativa per ${recipe.title}, non una fotografia del piatto` : "Illustrazione editoriale di una bowl colorata"}>
      <defs>
        <radialGradient id={`${id}-bg`}><stop stopColor={sweet ? "#ead7c9" : "#d5dfc9"}/><stop offset="1" stopColor={sweet ? "#e8c8b8" : "#bac7af"}/></radialGradient>
        <radialGradient id={`${id}-plate`} cx=".42" cy=".3"><stop stopColor="#fffdf4"/><stop offset=".76" stopColor="#f1e9d9"/><stop offset="1" stopColor="#d6cfbc"/></radialGradient>
        <linearGradient id={`${id}-chicken`} x2=".8" y2="1"><stop stopColor="#e9b061"/><stop offset=".5" stopColor="#cd8542"/><stop offset="1" stopColor="#a25929"/></linearGradient>
        <linearGradient id={`${id}-leaf`} x2="1" y2="1"><stop stopColor="#89a74c"/><stop offset=".5" stopColor="#4b753d"/><stop offset="1" stopColor="#244d34"/></linearGradient>
        <linearGradient id={`${id}-cake`} x2="0" y2="1"><stop stopColor="#e3b873"/><stop offset=".6" stopColor="#c48d45"/><stop offset="1" stopColor="#8a5428"/></linearGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="7" dy="20" stdDeviation="18" floodColor="#33442e" floodOpacity=".25"/></filter>
        <filter id={`${id}-small`} x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="1" dy="4" stdDeviation="3" floodColor="#50381e" floodOpacity=".22"/></filter>
        <pattern id={`${id}-noise`} width="35" height="35" patternUnits="userSpaceOnUse"><circle cx="4" cy="7" r="1" fill="#fff" opacity=".1"/><circle cx="22" cy="28" r=".7" fill="#384b25" opacity=".09"/></pattern>
      </defs>
      <rect width="600" height="530" fill={`url(#${id}-bg)`}/>
      <rect width="600" height="530" fill={`url(#${id}-noise)`}/>
      <path d="M-20 392L187 546M-22 411L161 550M-15 432L131 550" stroke="#f0ede0" strokeWidth="10" opacity=".5"/>
      <g transform="rotate(-12 300 260)" filter={`url(#${id}-shadow)`}>
        <ellipse cx="300" cy="267" rx="216" ry="205" fill={`url(#${id}-plate)`}/>
        <ellipse cx="300" cy="267" rx="186" ry="176" fill="none" stroke="#c8bfab" strokeWidth="1.2" opacity=".65"/>
        <ellipse cx="300" cy="263" rx="182" ry="174" fill="#e4ddca" opacity=".27"/>
      </g>
      {sweet ? (
        <g filter={`url(#${id}-small)`}>
          {recipe?.family === "dessert" ? <g>
            <path d="M178 246Q186 375 296 389Q410 372 422 246Z" fill="#d9c5ae"/>
            <ellipse cx="300" cy="244" rx="123" ry="70" fill="#f4eee2"/>
            <ellipse cx="300" cy="242" rx="110" ry="59" fill="#fffaf0"/>
            <path d="M238 230C264 207 354 204 364 240C353 275 262 278 250 247C249 230 310 223 326 239" fill="none" stroke="#ede3cf" strokeWidth="7" strokeLinecap="round"/>
          </g> : [0, 1, 2, 3].map((layer) => <g key={layer}>
            <ellipse cx={300 - layer * 2} cy={325 - layer * 30} rx={125 - layer * 5} ry="64" fill={`url(#${id}-cake)`}/>
            <ellipse cx={300 - layer * 2} cy={315 - layer * 30} rx={124 - layer * 5} ry="59" fill="#e6bd80"/>
            <ellipse cx={300 - layer * 2} cy={313 - layer * 30} rx={109 - layer * 5} ry="47" fill="#d4a467" opacity=".6"/>
          </g>)}
          {creamy && <path d="M235 211C246 173 336 179 353 204C376 234 335 228 330 251C322 270 300 250 303 233C277 233 237 245 235 211Z" fill="#fffaf0"/>}
          {red && [[267, 193], [318, 183], [344, 213], [240, 236]].map(([x,y], i) => <g key={i} transform={`translate(${x} ${y}) rotate(${i*31})`}>
            <path d="M-15 -7Q0 -24 15 -7Q18 4 0 24Q-18 3 -15 -7" fill="#b94c43"/><path d="M-10 -11L0 -17L10 -11L2 -7" fill="#466e36"/>
            <path d="M-5 0L-4 3M4 7L5 10M0 -7L1 -4" stroke="#f5b976" strokeWidth="2"/>
          </g>)}
          {ids.includes("banana") && [[370,277],[383,307],[374,338]].map(([x,y], i) => <g key={i}><ellipse cx={x} cy={y} rx="25" ry="17" transform={`rotate(-25 ${x} ${y})`} fill="#f8e9b8"/><path d={`M${x-7} ${y}l7 -4l7 4l-7 4Z`} fill="#d3ba78"/></g>)}
        </g>
      ) : (
        <g filter={`url(#${id}-small)`}>
          {grain && Array.from({ length: 100 }, (_, i) => {
            const angle = i * 2.39996;
            const radius = Math.sqrt(i / 100) * 112;
            const x = 270 + Math.cos(angle) * radius;
            const y = 291 + Math.sin(angle) * radius * .83;
            return <ellipse key={i} cx={x} cy={y} rx="10" ry="3.7" transform={`rotate(${i*37} ${x} ${y})`} fill={i % 3 ? "#f6e9c9" : "#e6d1a3"}/>;
          })}
          {green && Array.from({ length: 14 }, (_, i) => <g key={i} transform={`translate(${179+(i%4)*34} ${172+Math.floor(i/4)*33}) rotate(${i*39})`}>
            <path d="M0 -30C36 -27 32 19 0 35C-31 11 -25 -24 0 -30" fill={`url(#${id}-leaf)`}/>
            <path d="M0 -23L0 28M0 -9L14 -17M0 7L-14 -2" fill="none" stroke="#adc47a" strokeWidth="1.4" opacity=".7"/>
          </g>)}
          {beef ? [0, 1, 2].map((i) => <g key={i} transform={`translate(${333 + (i % 2) * 32} ${196 + i * 64}) rotate(${i * 17 - 10})`}>
            <ellipse rx="62" ry="37" cy="8" fill="#774828"/>
            <ellipse rx="61" ry="37" fill={ids.includes("breadcrumbs") ? "#bb8844" : "#986039"}/>
            <ellipse rx="52" ry="29" fill={ids.includes("breadcrumbs") ? "#cf9f5c" : "#aa764a"}/>
            <path d="M-38 -16L-25 22M-13 -25L1 27M14 -25L28 19M38 -13L43 8" stroke="#684222" strokeWidth="4" opacity=".65"/>
            {ids.includes("breadcrumbs") && Array.from({ length: 20 }, (_, dot) => <circle key={dot} cx={Math.cos(dot * 2.4) * Math.sqrt(dot / 20) * 48} cy={Math.sin(dot * 2.4) * Math.sqrt(dot / 20) * 25} r="1.8" fill="#ead09a"/>)}
          </g>) : protein && [0,1,2,3,4,5,6].map((i) => <g key={i} transform={`translate(${330+(i%2)*53} ${199+Math.floor(i/2)*48}) rotate(${i%2 ? 21 : -19})`}>
            <path d="M-30 -20Q0 -32 30 -19L35 13Q4 28 -28 18Z" fill={`url(#${id}-chicken)`}/>
            <path d="M-19 -15L-13 15M-3 -18L3 18M14 -17L21 13" stroke="#895225" strokeWidth="3.5" opacity=".65"/>
            <path d="M-21 -19Q0 -25 23 -17" stroke="#f2d294" strokeWidth="3" fill="none" opacity=".6"/>
          </g>)}
          {red && [[203,352],[234,381],[272,385],[177,319]].map(([x,y],i) => <g key={i} transform={`translate(${x} ${y}) rotate(${i*65})`}>
            <ellipse rx="23" ry="18" fill="#c65d40"/><ellipse rx="17" ry="13" fill="#e88459"/><path d="M-10 0L10 0M0 -10L0 10" stroke="#f3bd78" strokeWidth="2"/><circle r="4" fill="#edd698"/>
          </g>)}
          {creamy && <path d="M313 265C301 245 319 232 338 242C353 252 344 271 361 279C375 294 357 304 345 297L312 289C296 286 302 273 313 265Z" fill="#fffaf0"/>}
        </g>
      )}
      <ellipse cx="480" cy="91" rx="26" ry="42" fill="#a4b98b" opacity=".4" transform="rotate(34 480 91)"/>
      <path d="M490 54Q477 75 470 99" stroke="#718856" fill="none" strokeWidth="2" opacity=".4"/>
    </svg>
  );
}
