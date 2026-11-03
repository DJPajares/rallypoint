"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NumberField } from "@base-ui/react/number-field";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { DayPicker } from "react-day-picker";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { cn } from "../lib/utils";
import { buttonClass } from "../classes";
import { bareInputClass, controlBoxClass, controlClass } from "../control";
import { useIsPhone } from "../media";
import { Sheet } from "./sheet";
import { Checkbox } from "./ui/checkbox";
import { PopoverContent } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import {
  formatLocalDateTime,
  joinLocalDateTime,
  splitLocalDateTime,
  timeSlots,
} from "../datetime";

interface ControlProps {
  /** The control's id; the surrounding Field's label points at it. */
  id: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

const caretClass =
  "ml-auto inline-flex flex-none text-muted-foreground transition-transform duration-150 ease-standard in-data-popup-open:rotate-180";

/**
 * A date and time on the session's own wall clock, stored as the same
 * "YYYY-MM-DDTHH:mm" string a datetime-local input produces. The trigger reads
 * like a sentence. On larger screens a popover pairs a month calendar with
 * 15-minute slots; on a phone the same panel opens as a bottom sheet, where
 * there is room for it above the keyboard-free half of the screen.
 */
export function DateTimeField({
  id,
  value,
  onChange,
  disabled,
  title = "Choose date and time",
  placeholder = "Pick a date and time",
  defaultTime = "18:00",
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  /** The sheet heading on phones; use the field's label. */
  title?: string;
  placeholder?: string;
  /** Used when a date is picked before any time. */
  defaultTime?: string;
}) {
  const [open, setOpen] = useState(false);
  const phone = useIsPhone();
  const button = useRef<HTMLButtonElement>(null);
  // Safari doesn't focus a tapped button, so the dialog can't hand focus back
  // on its own; return it to the trigger explicitly.
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const label = formatLocalDateTime(value);
  const trigger = {
    id,
    className: cn(controlClass, "cursor-pointer"),
    disabled,
    // The field's label plus the chosen value, so "Starts, Thu, Nov 5 ·
    // 7:00 PM" is announced rather than the label alone.
    "aria-labelledby": `${id}-label ${id}-value`,
    "aria-describedby": describedBy,
    children: (
      <>
        <CalendarBlankIcon
          className="flex-none text-muted-foreground"
          size={20}
          aria-hidden="true"
        />
        <span
          id={`${id}-value`}
          className={cn(
            "min-w-0 flex-1 truncate",
            label ? "tabular-nums" : "text-muted-foreground",
          )}
        >
          {label ?? placeholder}
        </span>
        <CaretDownIcon className={caretClass} size={16} aria-hidden="true" />
      </>
    ),
  };
  const done = buttonClass({ variant: "primary", size: "sm" });
  const panel = (doneButton: ReactNode) => (
    <DateTimePanel
      value={value}
      onChange={onChange}
      defaultTime={defaultTime}
      done={doneButton}
      inSheet={phone}
    />
  );
  if (phone)
    return (
      <>
        <button
          ref={button}
          type="button"
          aria-haspopup="dialog"
          data-popup-open={open || undefined}
          onClick={() => setOpen(true)}
          {...trigger}
        />
        <Sheet open={open} onClose={close} title={title}>
          {panel(
            <button type="button" className={done} onClick={close}>
              Done
            </button>,
          )}
        </Sheet>
      </>
    );
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger {...trigger} />
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-auto max-w-[calc(100vw-24px)]"
      >
        <PopoverPrimitive.Title className="sr-only">
          {title}
        </PopoverPrimitive.Title>
        {panel(
          <PopoverPrimitive.Close className={done}>
            Done
          </PopoverPrimitive.Close>,
        )}
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}

// The calendar's look, by react-day-picker part. Day cells carry data-today,
// data-selected, data-outside and data-disabled, which style their button.
const navButton =
  "inline-flex size-control-sm items-center justify-center rounded-full border-0 bg-transparent p-0 text-foreground hover:bg-muted disabled:text-muted-foreground disabled:opacity-50";
const calendarClasses = {
  root: "relative flex-none",
  month_caption: "flex h-control-sm items-center pl-2 font-semibold",
  nav: "absolute top-0 right-0 z-1 flex gap-1",
  button_previous: navButton,
  button_next: navButton,
  month_grid: "mt-1 border-collapse",
  weekday: "h-control-sm w-day text-xs font-semibold text-muted-foreground",
  day: "group/day py-0.5 text-center",
  day_button:
    "size-day rounded-full border-0 bg-transparent p-0 text-sm text-foreground tabular-nums transition-colors duration-150 ease-standard hover:bg-muted group-data-today/day:font-bold group-data-today/day:shadow-ring-chrome group-data-selected/day:bg-primary group-data-selected/day:font-bold group-data-selected/day:text-primary-foreground group-data-selected/day:shadow-none group-data-outside/day:text-muted-foreground group-data-outside/day:opacity-55 group-data-disabled/day:cursor-not-allowed group-data-disabled/day:opacity-35",
  hidden: "invisible",
};

function DateTimePanel({
  value,
  onChange,
  defaultTime,
  done,
  inSheet,
}: {
  value: string;
  onChange: (value: string) => void;
  defaultTime: string;
  done: ReactNode;
  inSheet: boolean;
}) {
  const { date, time } = splitLocalDateTime(value);
  return (
    <>
      <div
        className={cn("flex gap-3 max-md:flex-col", inSheet && "items-center")}
      >
        <DayPicker
          classNames={calendarClasses}
          mode="single"
          selected={date ?? undefined}
          defaultMonth={date ?? undefined}
          showOutsideDays
          onSelect={(day) => {
            if (day) onChange(joinLocalDateTime(day, time ?? defaultTime));
          }}
          components={{
            Chevron: ({ orientation }) =>
              orientation === "left" ? (
                <CaretLeftIcon size={18} aria-hidden="true" />
              ) : (
                <CaretRightIcon size={18} aria-hidden="true" />
              ),
          }}
        />
        <TimeSlots
          value={time}
          disabled={!date}
          inSheet={inSheet}
          onPick={(slot) => date && onChange(joinLocalDateTime(date, slot))}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        {value ? (
          <button
            type="button"
            className={cn(buttonClass({ variant: "link" }), "min-h-control-sm")}
            onClick={() => onChange("")}
          >
            Clear
          </button>
        ) : (
          <span />
        )}
        {done}
      </div>
    </>
  );
}

function TimeSlots({
  value,
  disabled,
  inSheet,
  onPick,
}: {
  value: string | null;
  disabled: boolean;
  inSheet: boolean;
  onPick: (slot: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const slots = useMemo(() => {
    const all = timeSlots(15);
    // An existing off-grid time (say 19:10) stays choosable.
    return value && !all.some((slot) => slot.value === value)
      ? [...all, ...timeSlots(0, [value])].sort((a, b) =>
          a.value.localeCompare(b.value),
        )
      : all;
  }, [value]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"], [data-anchor]')
      ?.scrollIntoView({ block: "center", inline: "center" });
  }, []);
  return (
    <div
      ref={list}
      // A column beside the calendar; on a phone one swipeable row under it.
      className={cn(
        "flex max-h-popover-list w-24 flex-col gap-1 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin] max-md:max-h-none max-md:w-auto max-md:max-w-[calc(var(--spacing-day)*7)] max-md:flex-row max-md:overflow-x-auto max-md:overflow-y-hidden",
        inSheet && "self-stretch max-md:max-w-none",
      )}
      role="group"
      aria-label={disabled ? "Time (pick a date first)" : "Time"}
    >
      {slots.map((slot) => (
        <button
          key={slot.value}
          type="button"
          className="min-h-control-sm flex-none rounded-full border border-border bg-card px-3 text-sm whitespace-nowrap text-foreground tabular-nums transition-colors duration-150 ease-standard not-disabled:hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-transparent aria-pressed:bg-primary aria-pressed:font-bold aria-pressed:text-primary-foreground"
          aria-pressed={slot.value === value}
          data-anchor={slot.value === "18:00" || undefined}
          disabled={disabled}
          onClick={() => onPick(slot.value)}
        >
          {slot.label}
        </button>
      ))}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** Choices under a heading, e.g. areas under their region. */
export interface OptionGroup {
  label: string;
  options: Option[];
}

/**
 * A list of fixed choices, styled like the other controls (shadcn Select).
 * Pass `groups` instead of `options` to show the choices under headings.
 */
export function SelectField({
  id,
  value,
  onChange,
  options,
  groups,
  placeholder,
  disabled,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
} & (
    | { options: Option[]; groups?: never }
    | { groups: OptionGroup[]; options?: never }
  )) {
  const items = options ?? groups.flatMap((group) => group.options);
  const item = (option: Option) => (
    <SelectItem key={option.value} value={option.value}>
      {option.label}
    </SelectItem>
  );
  return (
    <Select
      items={items}
      // With a placeholder, an empty value means nothing chosen yet; without
      // one, "" is a real choice (e.g. "No rating").
      value={placeholder && !value ? null : value}
      onValueChange={(next) => next !== null && onChange(String(next))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-describedby={describedBy}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent sideOffset={8} alignItemWithTrigger={false}>
        {options
          ? options.map(item)
          : groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.options.map(item)}
              </SelectGroup>
            ))}
      </SelectContent>
    </Select>
  );
}

const stepButton =
  "inline-flex size-control-sm flex-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground not-disabled:hover:bg-muted not-disabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

/**
 * A whole number with − and + buttons. The form keeps text, so the value goes
 * in and out as a string; an empty field stays empty rather than becoming 0.
 */
export function NumberStepper({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  "aria-describedby": describedBy,
}: ControlProps & {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
}) {
  const parsed = value.trim() === "" ? null : Number(value);
  return (
    <NumberField.Root
      id={id}
      value={Number.isFinite(parsed) ? parsed : null}
      onValueChange={(next) => onChange(next === null ? "" : String(next))}
      min={min}
      max={max}
      step={1}
      disabled={disabled}
    >
      <NumberField.Group className={cn(controlClass, controlBoxClass, "px-1")}>
        <NumberField.Decrement className={stepButton} aria-label="Decrease">
          <MinusIcon size={18} aria-hidden="true" />
        </NumberField.Decrement>
        <NumberField.Input
          className={cn(
            bareInputClass,
            "text-center font-semibold tabular-nums",
          )}
          aria-describedby={describedBy}
        />
        <NumberField.Increment className={stepButton} aria-label="Increase">
          <PlusIcon size={18} aria-hidden="true" />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}

/** A text input with a fixed prefix (a currency code) inside the same box. */
export function AffixInput({
  prefix,
  className,
  ...props
}: { prefix: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn(controlClass, controlBoxClass)}>
      <span
        className="flex-none border-r border-border pr-3 text-sm font-semibold text-muted-foreground"
        aria-hidden="true"
      >
        {prefix}
      </span>
      <input className={cn(bareInputClass, className)} {...props} />
    </div>
  );
}

/** An on/off setting with its label and an optional line of detail. */
export function SwitchField({
  checked,
  onCheckedChange,
  disabled,
  children,
  description,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="mt-4 mb-1 flex cursor-pointer items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3">
      <span className="grid gap-0.5">
        <span className="font-semibold">{children}</span>
        {description ? (
          <span className="text-sm font-normal text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </label>
  );
}

/** A checkbox with its label beside it; the whole row is the target. */
export function CheckField({
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="mt-4 mb-1 flex cursor-pointer items-start gap-3 font-medium">
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <span>{children}</span>
    </label>
  );
}
