import React from 'react';

export const GradientPattern = ({
    baseColor = '#8B5CF6',
    width = 600,
    height = 600,
    className = ''
}) => {
    // Convert hex to RGB for color manipulation
    // @ts-ignore
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    };

    // Create color variations
    const baseRgb = hexToRgb(baseColor);
    // @ts-ignore
    const createColorVariation = (r, g, b, hueShift = 0, saturationMultiplier = 1, lightnessShift = 0) => {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lightness = (max + min) / 2;

        const newLightness = Math.max(0, Math.min(255, lightness + lightnessShift));
        const ratio = lightness > 0 ? newLightness / lightness : 1;

        let newR = Math.max(0, Math.min(255, Math.floor(r * ratio * saturationMultiplier + hueShift)));
        let newG = Math.max(0, Math.min(255, Math.floor(g * ratio * saturationMultiplier)));
        let newB = Math.max(0, Math.min(255, Math.floor(b * ratio * saturationMultiplier - hueShift * 0.5)));

        return `rgb(${newR}, ${newG}, ${newB})`;
    };

    const color1 = baseColor;
    // @ts-ignore
    const color2 = createColorVariation(baseRgb.r, baseRgb.g, baseRgb.b, 40, 0.7, 50);
    // @ts-ignore
    const color3 = createColorVariation(baseRgb.r, baseRgb.g, baseRgb.b, -30, 1.3, -10);
    // @ts-ignore
    const color4 = createColorVariation(baseRgb.r, baseRgb.g, baseRgb.b, 60, 0.5, 70);
    // @ts-ignore
    const color5 = createColorVariation(baseRgb.r, baseRgb.g, baseRgb.b, -50, 1.1, 20);

    return (
        <svg
            width={width}
            height={height}
            viewBox={`${width*0.1} ${height*0.24} ${width*0.7} ${height*0.7}`}
            className={className}
            style={{ background: 'transparent' }}
        >
            <defs>
                <radialGradient id={baseColor + "flow1"} cx="30%" cy="20%" r="70%">
                    <stop offset="0%" stopColor={color1} stopOpacity="0.9" />
                    <stop offset="60%" stopColor={color2} stopOpacity="0.6" />
                    <stop offset="100%" stopColor={color3} stopOpacity="0.2" />
                </radialGradient>

                {/* Flowing gradient 2 */}
                <radialGradient id={baseColor + "flow2"} cx="70%" cy="80%" r="60%">
                    <stop offset="0%" stopColor={color4} stopOpacity="0.8" />
                    <stop offset="50%" stopColor={color1} stopOpacity="0.5" />
                    <stop offset="100%" stopColor={color5} stopOpacity="0.3" />
                </radialGradient>

                {/* Linear flow gradient */}
                <linearGradient id={baseColor + "flow3"} x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={color3} stopOpacity="0.7" />
                    <stop offset="30%" stopColor={color2} stopOpacity="0.4" />
                    <stop offset="70%" stopColor={color5} stopOpacity="0.6" />
                    <stop offset="100%" stopColor={color1} stopOpacity="0.3" />
                </linearGradient>

            </defs>

            {/* Base background */}
            <rect width="200%" height="200%" fill={color3} opacity="0.2" />


            {/* Flowing curve 3 - Diagonal wave across middle */}
            <path
                d={`M ${width * 0.1},${height * 0.8}
           C ${width * 0.3},${height * 0.4} ${width * 0.5},${height * 0.7} ${width * 0.7},${height * 0.3}
           C ${width * 0.85},${height * 0.1} ${width * 0.95},${height * 0.5} ${width * 1.1},${height * 0.2}
           L ${width * 1.1},${height * 0.9}
           C ${width * 0.9},${height * 0.95} ${width * 0.6},${height * 0.85} ${width * 0.3},${height * 1.1}
           C ${width * 0.2},${height * 1.0} ${width * 0.05},${height * 0.9} ${width * 0.1},${height * 0.8} Z`}
                fill={"url(#" + baseColor +"flow3)"}
            />

            <path
                d={`M ${width},${height * 0.5}
           C ${width * 0.85},${height * 0.65} ${width * 0.7},${height * 0.4} ${width * 0.5},${height * 0.7}
           C ${width * 0.3},${height * 0.95} ${width * 0.6},${height * 1.1} ${width * 0.9},${height * 0.95}
           L ${width},${height * 0.9}
           Z`}
                fill={color1}
                opacity="0.3"
            />
        </svg>
    );
};