import { Component, ComponentEvent } from "./index.js"

export class ElementWithLabel implements Component {
    protected div: HTMLDivElement = document.createElement("div")
    protected label: HTMLLabelElement = document.createElement("label")

    constructor(internalName: string, displayName?: string) {
        if (displayName) {
            this.label.htmlFor = internalName
            this.label.innerText = displayName
            this.div.appendChild(this.label)
        }
    }

    mount(parent: HTMLElement): void {
        parent.appendChild(this.div)
    }
    unmount(parent: HTMLElement): void {
        parent.removeChild(this.div)
    }
}

export type InputInit = {
    defaultValue?: string
    value?: string
    checked?: boolean
    step?: string
    accept?: string
    inputMode?: string
    hasEnableCheckbox?: boolean
    placeholer?: string
    formRequired?: boolean
    // Only allowed with type == "number"
    numberSlider?: {
        range_min: number,
        range_max: number
        // Use step to set the step
    }
}

export type InputChangeListener = (event: ComponentEvent<InputComponent>) => void

export class InputComponent extends ElementWithLabel {

    private fileLabel: HTMLDivElement | null = null
    private numberSlider: HTMLInputElement | null = null

    private inputEnabled: HTMLInputElement | null = null
    private input: HTMLInputElement = document.createElement("input")

    constructor(internalName: string, type: string, displayName?: string, init?: InputInit) {
        super(internalName, displayName)

        this.div.classList.add("input-div")

        this.input.id = internalName
        this.input.type = type
        if (init?.defaultValue != null) {
            this.input.defaultValue = init.defaultValue
        }
        if (init?.value != null) {
            this.input.value = init.value
        }
        if (init && init.checked != null) {
            this.input.checked = init.checked
        }
        if (init && init.step != null) {
            this.input.step = init.step
        }
        if (init && init.accept != null) {
            this.input.accept = init.accept
        }
        if (init && init.inputMode != null) {
            this.input.inputMode = init.inputMode
        }
        if (init && init.formRequired != null) {
            this.input.required = init.formRequired
        }
        if (init && init.placeholer != null) {
            this.input.placeholder = init.placeholer
        }

        if (type == "file") {
            this.fileLabel = document.createElement("div")
            this.fileLabel.innerText = this.label.innerText
            this.fileLabel.classList.add("file-label")

            this.label.innerText = "Open File"
            this.label.classList.add("file-button")

            this.div.insertBefore(this.fileLabel, this.label)
        }

        if (init?.hasEnableCheckbox) {
            this.inputEnabled = document.createElement("input")
            this.inputEnabled.type = "checkbox"
            this.inputEnabled.defaultChecked = false

            this.inputEnabled.addEventListener("change", () => {
                this.setEnabled(
                    this.inputEnabled?.checked ?? (() => { throw "inputEnabled is null" })()
                )

                this.div.dispatchEvent(new ComponentEvent("ml-change", this))
            })

            this.div.appendChild(this.inputEnabled)
        }

        this.div.appendChild(this.input)

        this.input.addEventListener("change", () => {
            if (this.numberSlider) {
                this.numberSlider.value = this.input.value
            }

            this.div.dispatchEvent(new ComponentEvent("ml-change", this))
        })

        if (init?.numberSlider && type != "number") {
            throw "tried to create InputComponent with number slider but type wasn't number"
        }
        if (type == "number" && init?.numberSlider) {
            this.numberSlider = document.createElement("input")
            this.numberSlider.type = "range"
            this.numberSlider.min = `${init.numberSlider.range_min}`
            this.numberSlider.max = `${init.numberSlider.range_max}`
            this.numberSlider.step = init.step?.toString() ?? ""

            this.numberSlider.addEventListener("change", () => {
                if (this.numberSlider) {
                    this.input.value = this.numberSlider.value
                } else {
                    throw "failed to get value of number slider because it wasn't created"
                }

                this.div.dispatchEvent(new ComponentEvent("ml-change", this))
            })

            this.div.appendChild(this.numberSlider)
        }

        if (init?.hasEnableCheckbox) {
            // The main logic is further up
            this.setEnabled(false)
        }
    }

    reset() {
        this.input.value = ""
        if (this.numberSlider) {
            this.numberSlider.value = ""
        }
    }

    setValue(value: string) {
        this.input.value = value
        if (this.numberSlider) {
            this.numberSlider.value = value
        }
    }
    getValue(): string {
        return this.input.value
    }

    isChecked(): boolean {
        return this.input.checked
    }

    getFiles(): FileList | null {
        return this.input.files
    }

    setEnabled(enabled: boolean) {
        if (this.inputEnabled) {
            this.inputEnabled.checked = enabled
        }

        this.input.disabled = !enabled
        if (this.numberSlider) {
            this.numberSlider.disabled = !enabled
        }
    }
    isEnabled(): boolean {
        return !this.input.disabled
    }

    addChangeListener(listener: InputChangeListener, options?: AddEventListenerOptions) {
        this.div.addEventListener("ml-change", listener as any, options)
    }
    removeChangeListener(listener: InputChangeListener) {
        this.div.removeEventListener("ml-change", listener as any)
    }

    setPlaceholder(newPlaceholder: string) {
        this.input.placeholder = newPlaceholder
    }

    mount(parent: HTMLElement): void {
        super.mount(parent)

        if (this.numberSlider) {
            this.numberSlider.value = this.input.value
        }
    }
}

export type SelectInit = {
    // Only uses datalist if supported
    hasSearch?: boolean
    preSelectedOption?: string
    displayName?: string,
}

export class SelectComponent extends ElementWithLabel {

    private strategy: "select" | "datalist"

    private preSelectedOption: string = ""
    private options: Array<{ value: string, name: string }>

    private inputElement: null | HTMLInputElement
    private optionRoot: HTMLSelectElement | HTMLDataListElement

    constructor(internalName: string, options: Array<{ value: string, name: string }>, init?: SelectInit) {
        super(internalName, init?.displayName)

        if (init && init.preSelectedOption) {
            this.preSelectedOption = init.preSelectedOption
        }
        this.options = options

        if (init && init.hasSearch && isElementSupported("datalist")) {
            this.strategy = "datalist"

            this.optionRoot = document.createElement("datalist")
            this.optionRoot.id = `${internalName}-list`

            this.inputElement = document.createElement("input")
            this.inputElement.type = "text"
            this.inputElement.id = internalName
            this.inputElement.setAttribute("list", this.optionRoot.id)

            if (init && init.preSelectedOption) {
                this.inputElement.defaultValue = init.preSelectedOption
            }

            this.div.appendChild(this.inputElement)
            this.div.appendChild(this.optionRoot)
        } else {
            this.strategy = "select"

            this.inputElement = null

            this.optionRoot = document.createElement("select")
            this.optionRoot.id = internalName

            this.div.appendChild(this.optionRoot)
        }

        for (const option of options) {
            const optionElement = document.createElement("option")

            if (this.strategy == "datalist") {
                optionElement.value = option.name
            } else if (this.strategy == "select") {
                optionElement.innerText = option.name
                optionElement.value = option.value
            }

            if (init && init.preSelectedOption == option.value) {
                optionElement.selected = true
            }

            this.optionRoot.appendChild(optionElement)
        }

        this.optionRoot.addEventListener("change", () => {
            this.div.dispatchEvent(new ComponentEvent("ml-change", this))
        })
    }

    reset() {
        if (this.strategy == "datalist") {
            const inputElement = (this.inputElement as HTMLInputElement)
            inputElement.value = ""
        } else {
            const selectElement = (this.optionRoot as HTMLSelectElement)
            selectElement.value = this.preSelectedOption
        }
    }

    getValue(): string | null {
        if (this.strategy == "datalist") {
            const name = (this.inputElement as HTMLInputElement).value

            return this.options.find(option => option.name == name)?.value ?? ""
        } else if (this.strategy == "select") {
            return (this.optionRoot as HTMLSelectElement).value
        }

        throw "Invalid strategy for select input field"
    }

    setOptionEnabled(value: string, enabled: boolean) {
        for (const optionElement of this.optionRoot.options) {
            if (optionElement.value == value) {
                optionElement.disabled = !enabled
            }
        }
    }

    addChangeListener(listener: InputChangeListener, options?: AddEventListenerOptions) {
        this.div.addEventListener("ml-change", listener as any, options)
    }
    removeChangeListener(listener: InputChangeListener) {
        this.div.removeEventListener("ml-change", listener as any)
    }
}

export function isElementSupported(tag: string) {
    // Create a test element for the tag
    const element = document.createElement(tag);

    // Check for support of custom elements registered via
    // `document.registerElement`
    if (tag.indexOf('-') > -1) {
        // Registered elements have their own constructor, while unregistered
        // ones use the `HTMLElement` or `HTMLUnknownElement` (if invalid name)
        // constructor (http://stackoverflow.com/a/28210364/1070244)
        return (
            element.constructor !== window.HTMLUnknownElement &&
            element.constructor !== window.HTMLElement
        );
    }

    // Obtain the element's internal [[Class]] property, if it doesn't 
    // match the `HTMLUnknownElement` interface than it must be supported
    return toString.call(element) !== '[object HTMLUnknownElement]';
};