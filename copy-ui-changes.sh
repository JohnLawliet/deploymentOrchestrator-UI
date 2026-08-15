#!/bin/sh

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
CHANGES_DIR="$PROJECT_ROOT/ui-changes"

# Create backend-changes directory
mkdir -p "$CHANGES_DIR"

# Get modified / added / untracked files from Git
git -C "$PROJECT_ROOT" status --porcelain | while IFS= read -r line
do
    # Remove Git's two-character status prefix and following space
    file=$(printf '%s\n' "$line" | cut -c4-)

    # Handle renamed files
    case "$file" in
        *" -> "*)
            file=${file##* -> }
            ;;
    esac

    # Remove surrounding quotes if present
    file=$(printf '%s\n' "$file" | sed 's/^"//; s/"$//')

    source_file="$PROJECT_ROOT/$file"
    destination_file="$CHANGES_DIR/$file"

    # Skip deleted files
    if [ ! -f "$source_file" ]; then
        continue
    fi

    # Create destination directory structure
    mkdir -p "$(dirname "$destination_file")"

    # Copy the file
    cp "$source_file" "$destination_file"

    echo "Copied: $file"
done

echo ""
echo "Done."
echo "Changes copied to: $CHANGES_DIR"
