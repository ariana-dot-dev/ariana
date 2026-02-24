import { pattern1, pattern2, pattern3, pattern4, pattern5, pattern6 } from "./patterns/pattern-constants";
import { useIsBrowser } from "@/hooks/useIsBrowser";

type BackgroundProps = {
  className?: string;
  background:
    | { type: 'pattern'; patternId: 1 | 2 | 3 | 4 | 5 | 6 }
    | { type: 'image'; imageId: string; url?: string };
};

const Background = ({ className = "", background }: BackgroundProps) => {
  const bg = background;
  const isBrowser = useIsBrowser();

  if (bg.type === 'image') {
    const baseUrl = import.meta.env.BASE_URL;
    // Use compressed web versions for browser, full quality for desktop app
    const imageSuffix = isBrowser ? '-web.jpg' : '.jpg';
    const imageUrl = bg.url || `${baseUrl}background${bg.imageId}${imageSuffix}`;

    return (
      <>
        <div className="absolute top-0 left-0 w-full h-full dark:bg-darkest bg-lightest" />
        <img
          src={imageUrl}
          alt=""
          className={`absolute object-cover top-0 left-0 opacity-80 contrast-[100%] saturate-100 dark:contrast-[110%] dark:saturate-150 h-full w-full ${className}`}
        />
        <div className="absolute top-0 left-0 w-full h-full dark:bg-background/60 bg-background-darker/5" />
      </>
    );
  }

  // Pattern rendering
  // const patternConfig = bg.patternId === 1 ? pattern1 : bg.patternId === 2 ? pattern2 : bg.patternId === 3 ? pattern3 : pattern4;
  let patternConfig = pattern1;
  if (bg.patternId === 2) patternConfig = pattern2;
  if (bg.patternId === 3) patternConfig = pattern3;
  if (bg.patternId === 4) patternConfig = pattern4;
  if (bg.patternId === 5) patternConfig = pattern5;
  if (bg.patternId === 6) patternConfig = pattern6;
  
  const { pathData, naturalWidth, naturalHeight, multiplier } = patternConfig;

  return (
    <>
      <div className="dark:block hidden w-full h-full overflow-hidden max-h-full max-w-full">
        <svg
          className={`w-full h-full dark:text-background-darker/60 dark:bg-background ${className}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id={`topography-${bg.patternId}`}
              patternUnits="userSpaceOnUse"
              width={naturalWidth * multiplier}
              height={naturalHeight * multiplier}
              viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
            >
              <path fill="currentColor" d={pathData} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#topography-${bg.patternId})`} />
        </svg>
      </div>
      <div className="dark:hidden block w-full h-full">
        <svg
          className={`w-full h-full text-muted/20 bg-background-darker ${className}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id={`topography2-${bg.patternId}`}
              patternUnits="userSpaceOnUse"
              width={naturalWidth * multiplier}
              height={naturalHeight * multiplier}
              viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
            >
              <path fill="currentColor" d={pathData} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#topography2-${bg.patternId})`} />
        </svg>
      </div>
    </>
  );
};

export default Background;
